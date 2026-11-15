from __future__ import annotations
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

class SandboxUnavailable(RuntimeError):
    pass

class DockerSandboxRunner:
    """Runs a candidate in a disposable, digest-pinned, resource-limited Docker container."""
    DEFAULT_IMAGE = "python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b"
    SANDBOX_LABEL = "com.samurai.factory.sandbox"

    def __init__(self, image: str | None = None, timeout: int = 8):
        self.image = image or os.environ.get("SAMURAI_FACTORY_IMAGE", self.DEFAULT_IMAGE)
        if not re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", self.image):
            raise ValueError("SANDBOX_IMAGE_DIGEST_REQUIRED")
        self.timeout = max(1, min(int(timeout), 30))

    def _cleanup_timed_out_container(self, docker: str, job_label: str) -> None:
        query = subprocess.run(
            [docker, "ps", "-aq", "--filter", f"label={self.SANDBOX_LABEL}=true",
             "--filter", f"label=com.samurai.factory.job={job_label}"],
            check=True, capture_output=True, text=True, timeout=4
        )
        container_ids = [item.strip() for item in query.stdout.splitlines() if item.strip()]
        for container_id in container_ids:
            subprocess.run(
                [docker, "rm", "-f", container_id],
                check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4
            )
        remaining = subprocess.run(
            [docker, "ps", "-aq", "--filter", f"label=com.samurai.factory.job={job_label}"],
            check=True, capture_output=True, text=True, timeout=4
        )
        if remaining.stdout.strip():
            raise RuntimeError("SANDBOX_TIMEOUT_CLEANUP_FAILED")

    def run_smoke_test(self, module_file: Path) -> None:
        docker = shutil.which("docker")
        if not docker:
            raise SandboxUnavailable("DOCKER_SANDBOX_UNAVAILABLE")
        module_file = Path(module_file)
        if module_file.is_symlink():
            raise ValueError("SANDBOX_MODULE_FILE_INVALID")
        module_file = module_file.resolve()
        if not module_file.is_file():
            raise ValueError("SANDBOX_MODULE_FILE_INVALID")

        job_label = uuid.uuid4().hex
        script = (
            "import importlib.util; "
            "s=importlib.util.spec_from_file_location('candidate','/module.py'); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            "r=m.run([1,2,3]); "
            "assert r == [1,2,3], 'SMOKE_TEST_FAILED'"
        )
        cmd = [
            docker, "run", "--rm", "--network=none", "--read-only",
            "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--pids-limit=32", "--memory=128m", "--memory-swap=128m", "--cpus=0.5",
            "--ulimit", "nofile=64:64", "--ulimit", "fsize=1048576:1048576",
            "--user=65534:65534", "-e", "PYTHONDONTWRITEBYTECODE=1",
            "--label", f"{self.SANDBOX_LABEL}=true",
            "--label", f"com.samurai.factory.job={job_label}",
            "--mount", f"type=bind,src={module_file},dst=/module.py,readonly",
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
            self.image, "python", "-I", "-c", script
        ]
        try:
            subprocess.run(
                cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=self.timeout
            )
        except subprocess.TimeoutExpired as exc:
            try:
                self._cleanup_timed_out_container(docker, job_label)
            except Exception as cleanup_error:
                raise RuntimeError("SANDBOX_TIMEOUT_CLEANUP_FAILED") from cleanup_error
            raise RuntimeError("SANDBOX_TIMEOUT") from exc
        except subprocess.CalledProcessError as exc:
            raise RuntimeError("SANDBOX_TEST_FAILED") from exc
