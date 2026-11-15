from __future__ import annotations
import hashlib
import os
from pathlib import Path
import tempfile
import uuid

from .registry import Registry
from .runner import DockerSandboxRunner
from .validation import validate_name, validate_source


def _fsync_dir(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class SoftwareFactory:
    def __init__(self, root: str | Path, runner=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.staging = self.root / "staging"
        self.modules = self.root / "modules"
        self.staging.mkdir(exist_ok=True)
        self.modules.mkdir(exist_ok=True)
        os.chmod(self.staging, 0o700)
        os.chmod(self.modules, 0o750)
        # Reject symlinked workspaces: staging/modules must remain under the selected root.
        if self.staging.is_symlink() or self.modules.is_symlink():
            raise ValueError("FACTORY_DIRECTORY_SYMLINK")
        self.staging = self.staging.resolve()
        self.modules = self.modules.resolve()
        if self.staging.parent != self.root or self.modules.parent != self.root:
            raise ValueError("FACTORY_DIRECTORY_ESCAPE")
        self.registry = Registry(self.root)
        self.runner = runner or DockerSandboxRunner()

    def create(self, name: str, source: str) -> dict:
        name = validate_name(name)
        validate_source(source)
        target = self.modules / f"{name}.py"
        if target.exists() or target.is_symlink() or name in self.registry.list():
            raise FileExistsError("MODULE_ALREADY_EXISTS")

        fd, staged_name = tempfile.mkstemp(prefix=f"{name}-", suffix=".py", dir=self.staging)
        staged = Path(staged_name)
        published = False
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(source)
                f.flush()
                os.fsync(f.fileno())

            # Keep the staging directory private on the host, but make the candidate
            # readable to the container's non-root UID through a read-only bind mount.
            os.chmod(staged, 0o444)
            # Generated code is executed only by the configured isolated runner.
            self.runner.run_smoke_test(staged)

            digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
            metadata = {
                "sha256": digest,
                "status": "validated",
                "runtime": "docker-no-network",
            }

            # Atomic, exclusive publication of the already-complete staged inode.
            # Unlike writing the destination directly, readers never observe a partial file.
            os.link(staged, target, follow_symlinks=False)
            published = True
            os.chmod(target, 0o440, follow_symlinks=False)
            _fsync_dir(self.modules)

            try:
                self.registry.put(name, metadata)
            except Exception:
                # Compensate even if the atomic registry replace succeeded but a later
                # durability operation reported an error.
                try:
                    self.registry.remove(name)
                except Exception:
                    pass
                target.unlink(missing_ok=True)
                _fsync_dir(self.modules)
                published = False
                raise

            return {"name": name, **metadata}
        finally:
            staged.unlink(missing_ok=True)
            # Failure between hard-link publication and registry commit must not
            # leave a module that is invisible to the registry.
            if published:
                try:
                    registered = name in self.registry.list()
                except Exception:
                    registered = False
                if not registered:
                    target.unlink(missing_ok=True)
                    _fsync_dir(self.modules)

    def destroy(self, name: str) -> bool:
        name = validate_name(name)
        meta = self.registry.list().get(name)
        if not meta:
            return False
        target = self.modules / f"{name}.py"
        if target.is_symlink() or target.resolve().parent != self.modules:
            raise ValueError("MODULE_PATH_INVALID")
        if not target.is_file():
            raise FileNotFoundError("REGISTERED_MODULE_MISSING")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != meta.get("sha256"):
            raise RuntimeError("MODULE_HASH_MISMATCH")

        # Rename to a private tombstone first; restore it if registry update fails.
        tombstone = self.modules / f".{name}.{uuid.uuid4().hex}.deleting"
        os.replace(target, tombstone)
        _fsync_dir(self.modules)
        try:
            if not self.registry.remove(name):
                raise RuntimeError("REGISTRY_ENTRY_MISSING")
        except Exception:
            os.replace(tombstone, target)
            _fsync_dir(self.modules)
            raise
        tombstone.unlink(missing_ok=True)
        _fsync_dir(self.modules)
        return True
