from __future__ import annotations
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import threading
import uuid

try:
    import fcntl
except ImportError:  # pragma: no cover - POSIX hosts provide fcntl
    fcntl = None

from .registry import Registry
from .runner import DockerSandboxRunner
from .contract import DEFAULT_CONTRACT, validate_contract, validate_input
from .critic import LEGACY_REVIEW, require_approved_source
from .validation import validate_name


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class SoftwareFactory:
    """Versioned module lifecycle. Candidate code only runs through the sandbox runner."""
    def __init__(self, root: str | Path, runner=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.staging = self.root / "staging"
        self.modules = self.root / "modules"
        self.versions = self.root / "versions"
        for directory in (self.staging, self.modules, self.versions):
            directory.mkdir(exist_ok=True)
            if directory.is_symlink():
                raise ValueError("FACTORY_DIRECTORY_SYMLINK")
            if directory.resolve().parent != self.root:
                raise ValueError("FACTORY_DIRECTORY_ESCAPE")
        self.staging = self.staging.resolve()
        self.modules = self.modules.resolve()
        self.versions = self.versions.resolve()
        os.chmod(self.staging, 0o700)
        os.chmod(self.modules, 0o750)
        os.chmod(self.versions, 0o750)
        self.registry = Registry(self.root)
        self.runner = runner or DockerSandboxRunner()
        self._operation_lock = threading.RLock()
        self._lock_file = self.root / ".factory.lock"

    @contextmanager
    def _operation_guard(self):
        # Serialize file + registry transitions across threads and POSIX processes.
        with self._operation_lock:
            flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(self._lock_file, flags, 0o600)
            try:
                if fcntl is not None:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                yield
            finally:
                try:
                    if fcntl is not None:
                        fcntl.flock(fd, fcntl.LOCK_UN)
                finally:
                    os.close(fd)

    def _version_dir(self, name: str, create: bool = False) -> Path:
        path = self.versions / validate_name(name)
        if path.is_symlink():
            raise ValueError("VERSION_DIRECTORY_SYMLINK")
        if create:
            path.mkdir(mode=0o750, exist_ok=True)
        if path.exists() and (not path.is_dir() or path.resolve().parent != self.versions):
            raise ValueError("VERSION_DIRECTORY_INVALID")
        return path

    def _version_file(self, name: str, version: int, digest: str) -> Path:
        return self._version_dir(name) / f"v{version}-{digest}.py"

    def _stage_candidate(self, name: str, source: str) -> Path:
        fd, filename = tempfile.mkstemp(prefix=f"{name}-", suffix=".py", dir=self.staging)
        staged = Path(filename)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(source)
            f.flush()
            os.fsync(f.fileno())
        # Docker's non-root UID can read the single bind-mounted file. The host
        # staging directory itself remains private (0700).
        os.chmod(staged, 0o444)
        return staged

    @staticmethod
    def _hash(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def _verify_active(self, name: str, metadata: dict) -> Path:
        target = self.modules / f"{name}.py"
        if target.is_symlink() or not target.is_file():
            raise RuntimeError("ACTIVE_MODULE_MISSING_OR_INVALID")
        if self._hash(target) != metadata.get("sha256"):
            raise RuntimeError("MODULE_HASH_MISMATCH")
        return target

    def _switch_active(self, version_file: Path, target: Path) -> None:
        if version_file.is_symlink() or not version_file.is_file():
            raise FileNotFoundError("VERSION_ARTIFACT_MISSING")
        temporary = self.modules / f".{target.stem}.{uuid.uuid4().hex}.next"
        try:
            os.link(version_file, temporary, follow_symlinks=False)
            os.replace(temporary, target)
            _fsync_dir(self.modules)
        finally:
            temporary.unlink(missing_ok=True)

    def create(self, name: str, source: str, contract=None) -> dict:
        name = validate_name(name)
        source_review = require_approved_source(source)
        validated_contract = validate_contract(contract)
        with self._operation_guard():
            target = self.modules / f"{name}.py"
            if target.exists() or target.is_symlink() or name in self.registry.list():
                raise FileExistsError("MODULE_ALREADY_EXISTS")
            digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
            staged = self._stage_candidate(name, source)
            version_dir = self._version_dir(name, create=True)
            version_file = version_dir / f"v1-{digest}.py"
            published = False
            version_published = False
            registry_write_started = False
            metadata = {
                "sha256": digest,
                "status": "validated",
                "runtime": "docker-no-network",
                "version": 1,
                "sourceReview": source_review,
                "contract": validated_contract,
                "versions": [{"version": 1, "sha256": digest, "sourceReview": source_review, "contract": validated_contract}],
            }
            try:
                self.runner.run_smoke_test(staged, validated_contract)
                # First create the immutable version artifact; then point active name
                # at the same complete inode. Both links are exclusive.
                os.link(staged, version_file, follow_symlinks=False)
                version_published = True
                os.chmod(version_file, 0o440, follow_symlinks=False)
                os.link(version_file, target, follow_symlinks=False)
                published = True
                os.chmod(target, 0o440, follow_symlinks=False)
                _fsync_dir(version_dir)
                _fsync_dir(self.modules)
                registry_write_started = True
                self.registry.put(name, metadata)
                return {"name": name, **metadata}
            except Exception:
                if published:
                    target.unlink(missing_ok=True)
                if version_published:
                    version_file.unlink(missing_ok=True)
                if registry_write_started:
                    try:
                        self.registry.remove(name)
                    except Exception:
                        pass
                _fsync_dir(self.modules)
                if version_dir.exists():
                    _fsync_dir(version_dir)
                raise
            finally:
                staged.unlink(missing_ok=True)

    def promote(self, name: str, source: str, contract=None) -> dict:
        """Validate and atomically promote a new immutable version."""
        name = validate_name(name)
        source_review = require_approved_source(source)
        digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
        with self._operation_guard():
            metadata = self.registry.list().get(name)
            if not metadata:
                raise FileNotFoundError("MODULE_NOT_REGISTERED")
            validated_contract = validate_contract(contract if contract is not None else metadata.get("contract", DEFAULT_CONTRACT))
            target = self._verify_active(name, metadata)
            current_contract = validate_contract(metadata.get("contract", DEFAULT_CONTRACT))
            if digest == metadata["sha256"] and validated_contract == current_contract:
                return {"name": name, **metadata, "unchanged": True}

            current_version = int(metadata.get("version", 1))
            history = [dict(entry) for entry in (metadata.get("versions") or [{
                "version": current_version,
                "sha256": metadata["sha256"],
                "sourceReview": metadata.get("sourceReview", LEGACY_REVIEW),
            }])]
            for entry in history:
                if "sourceReview" not in entry:
                    entry["sourceReview"] = metadata.get("sourceReview", LEGACY_REVIEW) if int(entry["version"]) == current_version else LEGACY_REVIEW
                if "contract" not in entry:
                    entry["contract"] = metadata.get("contract", DEFAULT_CONTRACT) if int(entry["version"]) == current_version else DEFAULT_CONTRACT
            latest_version = max(int(entry["version"]) for entry in history)
            next_version = latest_version + 1
            version_dir = self._version_dir(name, create=True)
            previous_version_file = self._version_file(name, current_version, metadata["sha256"])
            if not previous_version_file.exists():
                # One-time migration path for metadata created before versioned storage.
                os.link(target, previous_version_file, follow_symlinks=False)
                os.chmod(previous_version_file, 0o440, follow_symlinks=False)
                _fsync_dir(version_dir)

            staged = self._stage_candidate(name, source)
            new_version_file = version_dir / f"v{next_version}-{digest}.py"
            new_version_created = False
            switched = False
            try:
                self.runner.run_smoke_test(staged, validated_contract)
                os.link(staged, new_version_file, follow_symlinks=False)
                new_version_created = True
                os.chmod(new_version_file, 0o440, follow_symlinks=False)
                _fsync_dir(version_dir)
                self._switch_active(new_version_file, target)
                switched = True

                updated = {
                    **metadata,
                    "sha256": digest,
                    "version": next_version,
                    "sourceReview": source_review,
                    "contract": validated_contract,
                    "versions": history + [{
                        "version": next_version,
                        "sha256": digest,
                        "sourceReview": source_review,
                        "contract": validated_contract,
                    }],
                }
                try:
                    self.registry.put(name, updated)
                except Exception:
                    try:
                        self._switch_active(previous_version_file, target)
                    finally:
                        try:
                            self.registry.put(name, metadata)
                        except Exception:
                            pass
                    raise
                return {"name": name, **updated}
            except Exception:
                if switched and self._hash(target) != metadata["sha256"]:
                    self._switch_active(previous_version_file, target)
                if new_version_created and new_version_file.exists():
                    new_version_file.unlink()
                    _fsync_dir(version_dir)
                raise
            finally:
                staged.unlink(missing_ok=True)

    def rollback(self, name: str, target_version: int | None = None) -> dict:
        """Switch active code back to a previously validated immutable version."""
        name = validate_name(name)
        with self._operation_guard():
            metadata = self.registry.list().get(name)
            if not metadata:
                raise FileNotFoundError("MODULE_NOT_REGISTERED")
            target = self._verify_active(name, metadata)
            history = list(metadata.get("versions") or [{
                "version": int(metadata.get("version", 1)),
                "sha256": metadata["sha256"],
            }])
            current_version = int(metadata.get("version", history[-1]["version"]))
            if target_version is None:
                candidates = [int(v["version"]) for v in history if int(v["version"]) < current_version]
                if not candidates:
                    raise ValueError("NO_PREVIOUS_VERSION")
                target_version = max(candidates)
            entry = next((v for v in history if int(v["version"]) == int(target_version)), None)
            if not entry or int(target_version) == current_version:
                raise ValueError("TARGET_VERSION_INVALID")
            version_file = self._version_file(name, int(target_version), entry["sha256"])
            if version_file.is_symlink() or not version_file.is_file() or self._hash(version_file) != entry["sha256"]:
                raise RuntimeError("VERSION_ARTIFACT_INVALID")

            previous_entry = next((v for v in history if int(v["version"]) == current_version), None)
            previous_file = self._version_file(name, current_version, metadata["sha256"])
            if not previous_entry or not previous_file.is_file() or self._hash(previous_file) != metadata["sha256"]:
                raise RuntimeError("CURRENT_VERSION_ARTIFACT_INVALID")

            self._switch_active(version_file, target)
            updated = {
                **metadata,
                "sha256": entry["sha256"],
                "version": int(target_version),
                "sourceReview": entry.get("sourceReview", LEGACY_REVIEW),
                "contract": entry.get("contract", DEFAULT_CONTRACT),
            }
            try:
                self.registry.put(name, updated)
            except Exception:
                self._switch_active(previous_file, target)
                try:
                    self.registry.put(name, metadata)
                except Exception:
                    pass
                raise
            return {"name": name, **updated, "rolledBack": True}

    def run(self, name: str, value):
        """Run the active, hash-verified version only inside the configured sandbox."""
        name = validate_name(name)
        validated_input = validate_input(value)
        with self._operation_guard():
            metadata = self.registry.list().get(name)
            if not metadata:
                raise FileNotFoundError("MODULE_NOT_REGISTERED")
            review = metadata.get("sourceReview", LEGACY_REVIEW)
            if review.get("decision") != "APPROVED":
                raise RuntimeError("MODULE_REVIEW_REQUIRED")
            target = self._verify_active(name, metadata)
            run_module = getattr(self.runner, "run_module", None)
            if not callable(run_module):
                raise RuntimeError("SANDBOX_RUN_UNAVAILABLE")
            result = run_module(target, validated_input)
            return {
                "name": name,
                "version": int(metadata.get("version", 1)),
                "result": result,
            }

    def destroy(self, name: str) -> bool:
        name = validate_name(name)
        with self._operation_guard():
            metadata = self.registry.list().get(name)
            if not metadata:
                return False
            target = self._verify_active(name, metadata)
            history = list(metadata.get("versions") or [{
                "version": int(metadata.get("version", 1)),
                "sha256": metadata["sha256"],
            }])
            version_dir = self._version_dir(name)
            if version_dir.exists():
                for entry in history:
                    version_file = self._version_file(name, int(entry["version"]), entry["sha256"])
                    if version_file.is_symlink() or not version_file.is_file() or self._hash(version_file) != entry["sha256"]:
                        raise RuntimeError("VERSION_ARTIFACT_INVALID")

            current_tombstone = self.modules / f".{name}.{uuid.uuid4().hex}.deleting"
            version_tombstone = self.versions / f".{name}.{uuid.uuid4().hex}.deleting"
            os.replace(target, current_tombstone)
            if version_dir.exists():
                os.replace(version_dir, version_tombstone)
            _fsync_dir(self.modules)
            _fsync_dir(self.versions)
            try:
                if not self.registry.remove(name):
                    raise RuntimeError("REGISTRY_ENTRY_MISSING")
            except Exception:
                os.replace(current_tombstone, target)
                if version_tombstone.exists():
                    os.replace(version_tombstone, version_dir)
                _fsync_dir(self.modules)
                _fsync_dir(self.versions)
                raise
            current_tombstone.unlink(missing_ok=True)
            if version_tombstone.exists():
                shutil.rmtree(version_tombstone)
            _fsync_dir(self.modules)
            _fsync_dir(self.versions)
            return True
