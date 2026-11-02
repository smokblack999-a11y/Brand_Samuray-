import pytest
from app.tariff import calculate_base_charge


RULE = {
    "tariff_id": "pilot-base-v1",
    "currency": "KZT",
    "rate_minor": 50000,
    "billing_increment_minutes": 30,
    "grace_minutes": 10,
    "max_charge_minor": 150000,
}


def test_grace_period_produces_zero_charge():
    result = calculate_base_charge(
        "2026-11-02T08:00:00+00:00",
        "2026-11-02T08:09:59+00:00",
        RULE,
    )
    assert result["base_charge_minor"] == 0
    assert result["billable_units"] == 0


def test_started_billing_interval_rounds_up_after_grace():
    result = calculate_base_charge(
        "2026-11-02T08:00:00+00:00",
        "2026-11-02T08:40:01+00:00",
        RULE,
    )
    assert result["billable_units"] == 2
    assert result["base_charge_minor"] == 100000


def test_maximum_charge_cap_is_applied():
    result = calculate_base_charge(
        "2026-11-02T08:00:00+00:00",
        "2026-11-02T11:00:00+00:00",
        RULE,
    )
    assert result["base_charge_minor"] == 150000


def test_timezone_offsets_are_normalized_to_same_instant():
    result = calculate_base_charge(
        "2026-11-02T13:00:00+05:00",
        "2026-11-02T08:40:00+00:00",
        RULE,
    )
    assert result["elapsed_seconds"] == 2400
    assert result["base_charge_minor"] == 50000


def test_exit_before_entry_is_rejected():
    with pytest.raises(ValueError):
        calculate_base_charge(
            "2026-11-02T09:00:00+00:00",
            "2026-11-02T08:00:00+00:00",
            RULE,
        )
