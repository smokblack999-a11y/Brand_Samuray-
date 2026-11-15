from __future__ import annotations
import json
import os
from pathlib import Path
import tempfile
from typing import Any

class Registry:
    """Metadata-only registry; generated code is never imported into Core."""
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.file = self.root / "registry.json"

    def list(self) -> dict[str, Any]:
        if not self.file.exists():
            return {}
        data = json.loads(self.file.read_text("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("REGISTRY_INVALID")
        return data

    def put(self, name: str, metadata: dict[str, Any]) -> None:
        data = self.list()
        data[name] = metadata
        self._write(data)

    def remove(self, name: str) -> bool:
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
            os.replace(tmp, self.file)
        except Exception:
            try: os.unlink(tmp)
            except FileNotFoundError: pass
            raise
