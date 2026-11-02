from datetime import datetime, timezone
from math import ceil


def calculate_base_charge(entry_at: str, exit_at: str, rule: dict) -> dict:
    """Calculate a simple fixed-rate tariff in integer minor currency units."""
    start = datetime.fromisoformat(entry_at.replace("Z", "+00:00"))
    end = datetime.fromisoformat(exit_at.replace("Z", "+00:00"))
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("entry_at and exit_at must include timezone")
    elapsed_seconds = (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds()
    if elapsed_seconds < 0:
        raise ValueError("exit_at must not be earlier than entry_at")

    grace_seconds = int(rule["grace_minutes"]) * 60
    increment_seconds = int(rule["billing_increment_minutes"]) * 60
    if increment_seconds <= 0:
        raise ValueError("billing_increment_minutes must be positive")

    billable_seconds = max(0, elapsed_seconds - grace_seconds)
    units = ceil(billable_seconds / increment_seconds) if billable_seconds else 0
    uncapped = units * int(rule["rate_minor"])
    cap = rule.get("max_charge_minor")
    amount = min(uncapped, int(cap)) if cap is not None else uncapped
    return {
        "elapsed_seconds": int(elapsed_seconds),
        "billable_seconds": int(billable_seconds),
        "billable_units": units,
        "base_charge_minor": amount,
        "currency": rule["currency"],
        "tariff_id": rule["tariff_id"],
    }
