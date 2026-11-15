from __future__ import annotations

import ast
from typing import Any

from .validation import ValidationError, validate_source

POLICY_VERSION = "factory-source-critic-v1"
FORBIDDEN_CALLS = {"open", "input", "eval", "exec", "compile", "__import__", "breakpoint"}
FORBIDDEN_OS_CALLS = {
    "system", "popen", "open", "remove", "unlink", "rmdir", "mkdir",
    "makedirs", "removedirs", "rename", "replace", "truncate", "chmod",
    "chown", "symlink", "link", "mkfifo", "mknod", "_exit", "fork", "forkpty",
    "execl", "execle", "execlp", "execv", "execve", "execvp", "execvpe",
    "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp", "spawnvpe",
}
FORBIDDEN_IMPORT_FROM = {
    ("os", name) for name in FORBIDDEN_OS_CALLS
} | {
    ("importlib", "import_module"),
    ("builtins", "eval"),
    ("builtins", "exec"),
    ("builtins", "__import__"),
}
LEGACY_REVIEW = {
    "decision": "LEGACY_UNVERIFIED",
    "policyVersion": "legacy-unreviewed",
    "findings": [{"code": "LEGACY_VERSION_NOT_REVIEWED", "severity": "warning"}],
}


def _literal(node: ast.AST | None) -> bool:
    if node is None:
        return True
    try:
        ast.literal_eval(node)
        return True
    except (ValueError, TypeError, SyntaxError):
        return False


def _attribute_path(node: ast.AST) -> tuple[str, list[str]] | None:
    parts: list[str] = []
    current = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        return current.id, list(reversed(parts))
    return None


def _add(findings: list[dict[str, str]], code: str, severity: str = "block") -> None:
    if not any(item["code"] == code for item in findings):
        findings.append({"code": code, "severity": severity})


def review_source(source: str) -> dict[str, Any]:
    """Static preflight review. Docker remains the execution security boundary."""
    findings: list[dict[str, str]] = []
    source_bytes = len(source.encode("utf-8")) if isinstance(source, str) else 0

    try:
        tree = validate_source(source)
    except ValidationError as exc:
        _add(findings, str(exc) if str(exc).isupper() else "SOURCE_VALIDATION_FAILED")
        try:
            tree = ast.parse(source, mode="exec") if isinstance(source, str) else None
        except SyntaxError:
            tree = None

    if tree is not None:
        run_defs = [
            node for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "run"
        ]
        if len(run_defs) != 1:
            _add(findings, "RUN_FUNCTION_COUNT_INVALID")
        elif isinstance(run_defs[0], ast.AsyncFunctionDef):
            _add(findings, "ASYNC_RUN_NOT_SUPPORTED")

        module_aliases: dict[str, str] = {}
        imported_dangerous_calls: set[str] = set()
        imported_path_classes: set[str] = set()

        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    local_name = alias.asname or alias.name.split(".")[0]
                    module_aliases[local_name] = alias.name.split(".")[0]
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                for alias in node.names:
                    if alias.name == "*":
                        _add(findings, "STAR_IMPORT_FORBIDDEN")
                    if (module, alias.name) in FORBIDDEN_IMPORT_FROM:
                        imported_dangerous_calls.add(alias.asname or alias.name)
                    if module == "pathlib" and alias.name == "Path":
                        imported_path_classes.add(alias.asname or alias.name)
                if module in {"os", "importlib", "builtins"} and any(
                    (module, alias.name) in FORBIDDEN_IMPORT_FROM for alias in node.names
                ):
                    _add(findings, "FORBIDDEN_IMPORT")

        # Module initialization must be declarative. Function bodies execute only
        # in Docker; top-level calls/branches/loops are not accepted in this MVP.
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
                if isinstance(node, ast.FunctionDef):
                    if node.decorator_list:
                        _add(findings, "IMPORT_TIME_DECORATOR")
                    defaults = list(node.args.defaults) + [x for x in node.args.kw_defaults if x is not None]
                    if any(any(isinstance(n, ast.Call) for n in ast.walk(value)) for value in defaults):
                        _add(findings, "IMPORT_TIME_DEFAULT_CALL")
                    annotations = [arg.annotation for arg in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)]
                    if node.args.vararg:
                        annotations.append(node.args.vararg.annotation)
                    if node.args.kwarg:
                        annotations.append(node.args.kwarg.annotation)
                    annotations.append(node.returns)
                    if any(any(isinstance(n, ast.Call) for n in ast.walk(value)) for value in annotations if value is not None):
                        _add(findings, "IMPORT_TIME_ANNOTATION_CALL")
            elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                continue
            elif isinstance(node, ast.Assign):
                if not _literal(node.value) or not all(isinstance(t, ast.Name) for t in node.targets):
                    _add(findings, "TOP_LEVEL_EXECUTION")
            elif isinstance(node, ast.AnnAssign):
                if not isinstance(node.target, ast.Name) or not _literal(node.value):
                    _add(findings, "TOP_LEVEL_EXECUTION")
            else:
                _add(findings, "TOP_LEVEL_EXECUTION")

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Name):
                if node.func.id in FORBIDDEN_CALLS or node.func.id in imported_dangerous_calls:
                    _add(findings, "FORBIDDEN_DYNAMIC_OR_IO_CALL")
            path = _attribute_path(node.func)
            if path:
                root, attrs = path
                module = module_aliases.get(root, root)
                if module == "os" and attrs and attrs[-1] in FORBIDDEN_OS_CALLS:
                    _add(findings, "FORBIDDEN_OS_PROCESS_CALL")
                if module == "sys" and attrs and attrs[-1] == "exit":
                    _add(findings, "FORBIDDEN_PROCESS_EXIT")
                if module == "importlib" and attrs and attrs[-1] == "import_module":
                    _add(findings, "FORBIDDEN_DYNAMIC_IMPORT")
                if module == "builtins" and attrs and attrs[-1] in {"eval", "exec", "__import__"}:
                    _add(findings, "FORBIDDEN_DYNAMIC_EXECUTION")
                if module == "pathlib" and "Path" in attrs and attrs[-1] in {
                    "open", "write_text", "write_bytes", "unlink", "rename", "replace",
                    "mkdir", "rmdir", "touch", "symlink_to", "hardlink_to", "chmod",
                }:
                    _add(findings, "FORBIDDEN_PATH_WRITE")
                if root in imported_path_classes and attrs and attrs[-1] in {
                    "open", "write_text", "write_bytes", "unlink", "rename", "replace",
                    "mkdir", "rmdir", "touch", "symlink_to", "hardlink_to", "chmod",
                }:
                    _add(findings, "FORBIDDEN_PATH_WRITE")

    findings.sort(key=lambda item: item["code"])
    return {
        "decision": "APPROVED" if not findings else "BLOCKED",
        "policyVersion": POLICY_VERSION,
        "sourceBytes": source_bytes,
        "findings": findings,
    }


def require_approved_source(source: str) -> dict[str, Any]:
    report = review_source(source)
    if report["decision"] != "APPROVED":
        code = report["findings"][0]["code"] if report["findings"] else "SOURCE_REVIEW_BLOCKED"
        raise ValidationError(code)
    return report
