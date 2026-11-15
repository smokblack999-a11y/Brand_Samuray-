from __future__ import annotations
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
from typing import Any

try:
    import fcntl
except ImportError:  # pragma: no cover - supported POSIX targets provide fcntl
    fcntl = None

_NAME = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_REGISTRY_BYTES = 1_048_576


def _validate_metadata(meta: Any) -> None:
    if not isinstance(meta, dict) or not _SHA256.fullmatch(str(meta.get("sha256", ""))):
        raise ValueError("REGISTRY_METADATA_INVALID")
    if meta.get("status") != "validated" or meta.get("runtime") != "docker-no-network":
        raise ValueError("REGISTRY_METADATA_INVALID")
    if "version" in meta or "versions" in meta:
        if not isinstance(meta.get("version"), int) or meta["version"] < 1:
            raise ValueError("REGISTRY_VERSION_INVALID")
        history = meta.get("versions")
        if not isinstance(history, list) or not history:
            raise ValueError("REGISTRY_VERSION_HISTORY_INVALID")
        seen = set()
        active_found = False
        for entry in history:
            if not isinstance(entry, dict):
                raise ValueError("REGISTRY_VERSION_HISTORY_INVALID")
            number = entry.get("version")
            digest = entry.get("sha256")
            if not isinstance(number, int) or number < 1 or number in seen or not _SHA256.fullmatch(str(digest or "")):
                raise ValueError("REGISTRY_VERSION_HISTORY_INVALID")
            seen.add(number)
            if number == meta["version"] and digest == meta["sha256"]:
                active_found = True
        if not active_found:
            raise ValueError("REGISTRY_ACTIVE_VERSION_INVALID")


class Registry:
    """Atomic metadata registry with thread and POSIX process write locking."""
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.file = self.root / "registry.json"
        self.lock_file = self.root / ".registry.lock"
        self._thread_lock = threading.RLock()

    def _exclusive(self):
        class LockContext:
            def __init__(inner, registry):
                inner.registry = registry
                inner.fd = None
            def __enter__(inner):
                inner.registry._thread_lock.acquire()
                try:
                    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
                    inner.fd = os.open(inner.registry.lock_file, flags, 0o600)
                    if fcntl is not None:
                        fcntl.flock(inner.fd, fcntl.LOCK_EX)
                    return inner
                except Exception:
                    inner.registry._thread_lock.release()
                    raise
            def __exit__(inner, exc_type, exc, tb):
                try:
                    if inner.fd is not None:
                        if fcntl is not None:
                            fcntl.flock(inner.fd, fcntl.LOCK_UN)
                        os.close(inner.fd)
                finally:
                    inner.registry._thread_lock.release()
        return LockContext(self)

    def list(self) -> dict[str, Any]:
        try:
            info = self.file.lstat()
        except FileNotFoundError:
            return {}
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise ValueError("REGISTRY_FILE_TYPE_INVALID")
        if info.st_size > _MAX_REGISTRY_BYTES:
            raise ValueError("REGISTRY_TOO_LARGE")
        try:
            data = json.loads(self.file.read_text("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("REGISTRY_INVALID") from exc
        if not isinstance(data, dict):
            raise ValueError("REGISTRY_INVALID")
        for name, meta in data.items():
            if not isinstance(name, str) or not _NAME.fullmatch(name):
                raise ValueError("REGISTRY_INVALID")
            _validate_metadata(meta)
        return data

    def put(self, name: str, metadata: dict[str, Any]) -> None:
        if not isinstance(name, str) or not _NAME.fullmatch(name):
            raise ValueError("REGISTRY_NAME_INVALID")
        _validate_metadata(metadata)
        with self._exclusive():
            data = self.list()
            data[name] = dict(metadata)
            self._write(data)

    def remove(self, name: str) -> bool:
        with self._exclusive():
            data = self.list()
            if name not in data:
                return False
            del data[name]
            self._write(data)
            return True

    def _write(self, data: dict[str, Any]) -> None:
        fd, tmp = tempfile.mkstemp(prefix=".registry-", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            if self.file.is_symlink():
                raise ValueError("REGISTRY_FILE_TYPE_INVALID")
            os.replace(tmp, self.file)
            dir_fd = os.open(self.root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except Exception:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
            raise
