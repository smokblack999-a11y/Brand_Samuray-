from __future__ import annotations
import hashlib
import os
from pathlib import Path
import tempfile
from .registry import Registry
from .runner import DockerSandboxRunner
from .validation import validate_name, validate_source

class SoftwareFactory:
    def __init__(self, root: str | Path, runner=None):
        self.root = Path(root).resolve()
        self.staging = self.root / "staging"
        self.modules = self.root / "modules"
        self.staging.mkdir(parents=True, exist_ok=True)
        self.modules.mkdir(parents=True, exist_ok=True)
        self.registry = Registry(self.root)
        self.runner = runner or DockerSandboxRunner()

    def create(self, name: str, source: str) -> dict:
        name = validate_name(name)
        validate_source(source)
        target = self.modules / f"{name}.py"
        if target.exists() or name in self.registry.list():
            raise FileExistsError("MODULE_ALREADY_EXISTS")
        fd, staged = tempfile.mkstemp(prefix=f"{name}-", suffix=".py", dir=self.staging)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(source)
                f.flush()
                os.fsync(f.fileno())
            self.runner.run_smoke_test(Path(staged))
            digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
            # Exclusive create prevents overwriting a concurrently-created module.
            try:
                out = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o440)
            except FileExistsError:
                raise FileExistsError("MODULE_ALREADY_EXISTS")
            with os.fdopen(out, "w", encoding="utf-8") as f:
                f.write(source)
                f.flush()
                os.fsync(f.fileno())
            meta = {"sha256": digest, "status": "validated", "runtime": "docker-no-network"}
            self.registry.put(name, meta)
            return {"name": name, **meta}
        finally:
            try: os.unlink(staged)
            except FileNotFoundError: pass

    def destroy(self, name: str) -> bool:
        name = validate_name(name)
        meta = self.registry.list().get(name)
        if not meta:
            return False
        target = (self.modules / f"{name}.py").resolve()
        if target.parent != self.modules.resolve():
            raise ValueError("MODULE_PATH_INVALID")
        if not target.is_file():
            raise FileNotFoundError("REGISTERED_MODULE_MISSING")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != meta.get("sha256"):
            raise RuntimeError("MODULE_HASH_MISMATCH")
        target.unlink()
        self.registry.remove(name)
        return True
