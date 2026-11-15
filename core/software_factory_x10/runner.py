from __future__ import annotations
import os
import shutil
import subprocess
from pathlib import Path

class SandboxUnavailable(RuntimeError):
    pass

class DockerSandboxRunner:
    """Runs one module inside a disposable, no-network Docker container."""
    def __init__(self, image: str | None = None, timeout: int = 8):
        self.image = image or os.environ.get("SAMURAI_FACTORY_IMAGE", "python:3.12-slim")
        self.timeout = max(1, min(int(timeout), 30))

    def run_smoke_test(self, module_file: Path) -> None:
        docker = shutil.which("docker")
        if not docker:
            raise SandboxUnavailable("DOCKER_SANDBOX_UNAVAILABLE")
        module_file = Path(module_file).resolve()
        script = (
            "import importlib.util,json; "
            "s=importlib.util.spec_from_file_location('candidate','/module.py'); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            "r=m.run([1,2,3]); "
            "assert r == [1,2,3], 'SMOKE_TEST_FAILED'"
        )
        cmd = [
            docker, "run", "--rm", "--network=none", "--read-only",
            "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--pids-limit=32", "--memory=128m", "--cpus=0.5",
            "--user=65534:65534",
            "--mount", f"type=bind,src={module_file},dst=/module.py,readonly",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
            self.image, "python", "-I", "-c", script
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=self.timeout)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("SANDBOX_TIMEOUT") from exc
        except subprocess.CalledProcessError as exc:
            raise RuntimeError("SANDBOX_TEST_FAILED") from exc
