from __future__ import annotations
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from software_factory_x10.factory import SoftwareFactory
from software_factory_x10.runner import SandboxUnavailable
from software_factory_x10.validation import ValidationError

MAX_INPUT_BYTES = 131_072
ERROR_CODE_RE = re.compile(r"^[A-Z0-9_]{3,64}$")


def handle_request(payload: Any, root: str | Path, runner=None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("REQUEST_INVALID")
    action = payload.get("action")
    if action not in {"list", "create", "promote", "rollback", "destroy", "run"}:
        raise ValueError("ACTION_INVALID")

    factory = SoftwareFactory(root, runner=runner)
    if action == "list":
        return {"modules": factory.registry.list()}

    name = payload.get("name")
    if action in {"create", "promote"}:
        source = payload.get("source")
        if not isinstance(source, str):
            raise ValueError("SOURCE_REQUIRED")
        if len(source.encode("utf-8")) > 64_000:
            raise ValueError("SOURCE_SIZE_INVALID")

    if action == "create":
        return {"module": factory.create(name, source, payload.get("contract"))}
    if action == "promote":
        return {"module": factory.promote(name, source, payload.get("contract"))}
    if action == "rollback":
        version = payload.get("version")
        if version is not None and (type(version) is not int or version < 1):
            raise ValueError("VERSION_INVALID")
        return {"module": factory.rollback(name, version)}
    if action == "run":
        if "input" not in payload:
            raise ValueError("RUN_INPUT_REQUIRED")
        return {"module": factory.run(name, payload["input"])}
    if action == "destroy":
        if not factory.destroy(name):
            raise FileNotFoundError("MODULE_NOT_REGISTERED")
        return {"deleted": True, "name": name}
    raise ValueError("ACTION_INVALID")


def error_code(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        candidate = str(exc)
    elif isinstance(exc, FileExistsError):
        candidate = "MODULE_ALREADY_EXISTS"
    elif isinstance(exc, FileNotFoundError):
        candidate = str(exc) or "MODULE_NOT_REGISTERED"
    elif isinstance(exc, SandboxUnavailable):
        candidate = str(exc) or "SANDBOX_UNAVAILABLE"
    elif isinstance(exc, (RuntimeError, ValueError)):
        candidate = str(exc)
    else:
        candidate = "FACTORY_OPERATION_FAILED"
    return candidate if ERROR_CODE_RE.fullmatch(candidate) else "FACTORY_OPERATION_FAILED"


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        print(json.dumps({"ok": False, "error": {"code": "REQUEST_TOO_LARGE"}}))
        return 2
    try:
        payload = json.loads(raw.decode("utf-8"))
        default_root = Path(__file__).resolve().parents[1] / "data" / "software-factory-x10"
        root = Path(os.environ.get("SAMURAI_FACTORY_ROOT") or default_root)
        result = handle_request(payload, root)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": {"code": error_code(exc)}}, ensure_ascii=False, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
