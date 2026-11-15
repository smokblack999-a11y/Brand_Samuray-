from __future__ import annotations
import json
import os
import re
import selectors
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from .contract import MAX_CONTRACT_BYTES, validate_contract, validate_input

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

    def run_smoke_test(self, module_file: Path, contract=None) -> None:
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
        validated_contract = validate_contract(contract)
        contract_json = json.dumps(validated_contract, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        script = """
import importlib.util
import json
import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("candidate", "/module.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
contract = json.loads(sys.argv[1])
for case in contract["cases"]:
    actual = module.run(case["input"])
    if actual != case["expected"]:
        raise AssertionError("SMOKE_TEST_FAILED")
"""
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
            self.image, "python", "-I", "-B", "-c", script, contract_json
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


    def run_module(self, module_file: Path, value):
        """Invoke one active module in a fresh disposable container and return JSON output."""
        docker = shutil.which("docker")
        if not docker:
            raise SandboxUnavailable("DOCKER_SANDBOX_UNAVAILABLE")
        module_file = Path(module_file)
        if module_file.is_symlink():
            raise ValueError("SANDBOX_MODULE_FILE_INVALID")
        module_file = module_file.resolve()
        if not module_file.is_file():
            raise ValueError("SANDBOX_MODULE_FILE_INVALID")

        validated_input = validate_input(value)
        input_json = json.dumps(validated_input, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        job_label = uuid.uuid4().hex
        script = """
import importlib.util
import json
import sys
sys.dont_write_bytecode = True

class QuietOutput:
    def write(self, value):
        return len(value)
    def flush(self):
        pass

real_stdout = sys.stdout
execution_error = None
sys.stdout = QuietOutput()
try:
    spec = importlib.util.spec_from_file_location("candidate", "/module.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    value = json.loads(sys.argv[1])
    result = module.run(value)
except Exception as exc:
    execution_error = type(exc).__name__.upper()
finally:
    sys.stdout = real_stdout

if execution_error:
    real_stdout.write(json.dumps({
        "ok": False,
        "error": "MODULE_EXECUTION_FAILED",
        "kind": execution_error
    }, separators=(",", ":")))
else:
    try:
        encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        real_stdout.write('{"ok":false,"error":"MODULE_OUTPUT_INVALID"}')
    else:
        raw = encoded.encode("utf-8")
        if len(raw) > 32768:
            real_stdout.write('{"ok":false,"error":"MODULE_OUTPUT_TOO_LARGE"}')
        else:
            real_stdout.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
real_stdout.flush()
"""
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
            self.image, "python", "-I", "-B", "-c", script, input_json
        ]
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        output = bytearray()
        selector = selectors.DefaultSelector()
        assert process.stdout is not None
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + self.timeout
        overflow = False
        timed_out = False
        try:
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                events = selector.select(min(remaining, 0.2))
                for key, _ in events:
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    output.extend(chunk)
                    if len(output) > MAX_CONTRACT_BYTES + 256:
                        overflow = True
                        break
                if overflow:
                    break
            if overflow or timed_out:
                process.kill()
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    pass
                try:
                    self._cleanup_timed_out_container(docker, job_label)
                except Exception as cleanup_error:
                    raise RuntimeError("SANDBOX_TIMEOUT_CLEANUP_FAILED") from cleanup_error
                if overflow:
                    raise RuntimeError("MODULE_OUTPUT_TOO_LARGE")
                raise RuntimeError("SANDBOX_TIMEOUT")
            return_code = process.wait(timeout=max(1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as exc:
            process.kill()
            process.wait(timeout=4)
            try:
                self._cleanup_timed_out_container(docker, job_label)
            except Exception as cleanup_error:
                raise RuntimeError("SANDBOX_TIMEOUT_CLEANUP_FAILED") from cleanup_error
            raise RuntimeError("SANDBOX_TIMEOUT") from exc
        finally:
            selector.close()
            if process.stdout:
                process.stdout.close()

        if return_code != 0:
            raise RuntimeError("SANDBOX_RUN_FAILED")
        try:
            response = json.loads(bytes(output).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("MODULE_OUTPUT_INVALID") from exc
        if not isinstance(response, dict) or "ok" not in response:
            raise RuntimeError("MODULE_OUTPUT_INVALID")
        if not response["ok"]:
            code = response.get("error")
            if code in {"MODULE_OUTPUT_TOO_LARGE", "MODULE_OUTPUT_INVALID"}:
                raise RuntimeError(code)
            if code == "MODULE_EXECUTION_FAILED":
                kind = response.get("kind", "UNKNOWN")
                safe_kind = re.sub(r"[^A-Z0-9_]", "", str(kind).upper())[:40] or "UNKNOWN"
                raise RuntimeError(f"MODULE_EXECUTION_FAILED_{safe_kind}")
            raise RuntimeError("MODULE_OUTPUT_INVALID")
        return response.get("result")
