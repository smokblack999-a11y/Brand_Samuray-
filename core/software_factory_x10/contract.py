from __future__ import annotations

import json
from typing import Any

MAX_CONTRACT_BYTES = 32 * 1024
MAX_TEST_CASES = 20
DEFAULT_CONTRACT = {
    "cases": [
        {"input": [1, 2, 3], "expected": [1, 2, 3]}
    ]
}


def validate_contract(contract: Any = None) -> dict[str, Any]:
    """Validate a data-only JSON test contract; never execute user-supplied test code."""
    if contract is None:
        contract = DEFAULT_CONTRACT
    if not isinstance(contract, dict) or set(contract) != {"cases"}:
        raise ValueError("CONTRACT_INVALID")
    cases = contract.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("CONTRACT_CASES_REQUIRED")
    if len(cases) > MAX_TEST_CASES:
        raise ValueError("CONTRACT_CASE_LIMIT")
    normalized = []
    for case in cases:
        if not isinstance(case, dict) or set(case) != {"input", "expected"}:
            raise ValueError("CONTRACT_CASE_INVALID")
        normalized.append({"input": case["input"], "expected": case["expected"]})
    result = {"cases": normalized}
    try:
        encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError, RecursionError) as exc:
        raise ValueError("CONTRACT_INVALID") from exc
    if len(encoded) > MAX_CONTRACT_BYTES:
        raise ValueError("CONTRACT_TOO_LARGE")
    # Round-trip ensures the registry only stores ordinary JSON values.
    return json.loads(encoded)
