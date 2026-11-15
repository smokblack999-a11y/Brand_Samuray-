from __future__ import annotations
import ast
import re

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
FORBIDDEN_IMPORTS = {"ctypes", "subprocess", "socket", "multiprocessing", "pty"}
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__"}

class ValidationError(ValueError):
    pass

def validate_name(name: str) -> str:
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise ValidationError("INVALID_MODULE_NAME")
    if name in {"registry", "factory", "validation", "runner"}:
        raise ValidationError("RESERVED_MODULE_NAME")
    return name

def validate_source(source: str) -> ast.Module:
    if not isinstance(source, str) or len(source.encode("utf-8")) > 64_000:
        raise ValidationError("SOURCE_SIZE_INVALID")
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise ValidationError("SOURCE_SYNTAX_INVALID") from exc
    if not any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "run" for n in tree.body):
        raise ValidationError("RUN_FUNCTION_REQUIRED")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name.split(".")[0] for a in node.names] if isinstance(node, ast.Import) else [(node.module or "").split(".")[0]]
            if any(n in FORBIDDEN_IMPORTS for n in names):
                raise ValidationError("FORBIDDEN_IMPORT")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            raise ValidationError("DYNAMIC_EXECUTION_FORBIDDEN")
    return tree
