from __future__ import annotations
import os
import re
import shutil
import subprocess
from pathlib import Path

class SandboxUnavailable(RuntimeError):
    pass

class DockerSandboxRunner:
    """Runs one module inside a disposable, no-network Docker container."""
    def __init__(self, image: str | None = None, timeout: int = 8):
        default_image = "python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b"
        self.image = image or os.environ.get("SAMURAI_FACTORY_IMAGE", default_image)
        if not re.fullmatch(r"[^@\\s]+@sha256:[0-9a-f]{64}", self.image):
            raise ValueError("SANDBOX_IMAGE_DIGEST_REQUIRED")
        self.timeout = max(1, min(int(timeout), 30))

    def run_smoke_test(self, module_file: Path) -> None:
        docker = shutil.which("docker")
        if not docker:
            raise SandboxUnavailable("DOCKER_SANDBOX_UNAVAILABLE")
        module_file = Path(module_file).resolve()
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
            "--mount", f"type=bind,src={module_file},dst=/module.py,readonly",
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
            self.image, "python", "-I", "-c", script
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=self.timeout)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("SANDBOX_TIMEOUT") from exc
        except subprocess.CalledProcessError as exc:
            raise RuntimeError("SANDBOX_TEST_FAILED") from exc
