from datetime import datetime, timezone
from app.audit import reconcile_events


def test_exit_without_entry_is_flagged():
    result = reconcile_events([{
        "event_id": "exit-1", "event_type": "exit", "plate_token": "opaque",
        "plate_masked": "123***01", "occurred_at": "2026-11-02T05:00:00+00:00"
    }])
    assert result["findings_total"] == 1
    assert result["findings"][0]["type"] == "EXIT_WITHOUT_ENTRY"


def test_exit_without_payment_is_flagged():
    rows = [
        {"event_id": "in-1", "event_type": "entry", "plate_token": "opaque",
         "plate_masked": "123***01", "occurred_at": "2026-11-02T05:00:00+00:00"},
        {"event_id": "out-1", "event_type": "exit", "plate_token": "opaque",
         "plate_masked": "123***01", "occurred_at": "2026-11-02T06:00:00+00:00"}
    ]
    result = reconcile_events(rows)
    assert result["findings"][0]["type"] == "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT"


def test_old_entry_without_exit_is_flagged():
    rows = [{"event_id": "in-1", "event_type": "entry", "plate_token": "opaque",
             "plate_masked": "123***01", "occurred_at": "2026-11-02T05:00:00+00:00"}]
    now = datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc)
    result = reconcile_events(rows, stale_after_minutes=120, now=now)
    assert result["findings"][0]["type"] == "ENTRY_WITHOUT_EXIT"


def test_payment_between_entry_and_exit_prevents_missing_payment_flag():
    rows = [
        {"event_id": "in-1", "event_type": "entry", "session_id": "sess-1", "plate_token": "opaque",
         "plate_masked": "123***01", "occurred_at": "2026-11-02T05:00:00+00:00"},
        {"event_id": "pay-1", "event_type": "payment", "session_id": "sess-1", "payment_status": "succeeded", "plate_token": "opaque",
         "plate_masked": "123***01", "occurred_at": "2026-11-02T05:30:00+00:00"},
        {"event_id": "out-1", "event_type": "exit", "session_id": "sess-1", "plate_token": "opaque",
         "plate_masked": "123***01", "occurred_at": "2026-11-02T06:00:00+00:00"}
    ]
    result = reconcile_events(rows)
    assert result["findings_total"] == 0


def test_refunded_payment_is_not_counted_as_settled():
    rows = [
        {"event_id": "entry-1", "event_type": "entry", "session_id": "session-refund",
         "occurred_at": "2026-11-02T05:00:00+00:00"},
        {"event_id": "payment-ok", "event_type": "payment", "session_id": "session-refund",
         "transaction_id": "txn-refund", "payment_status": "succeeded",
         "occurred_at": "2026-11-02T05:20:00+00:00"},
        {"event_id": "payment-refund", "event_type": "payment", "session_id": "session-refund",
         "transaction_id": "txn-refund", "payment_status": "refunded",
         "occurred_at": "2026-11-02T05:40:00+00:00"},
        {"event_id": "exit-1", "event_type": "exit", "session_id": "session-refund",
         "occurred_at": "2026-11-02T06:00:00+00:00"},
    ]
    result = reconcile_events(rows)
    assert result["findings_total"] == 1
    assert result["findings"][0]["type"] == "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT"


def test_refund_after_exit_reverses_payment_finding():
    rows = [
        {"event_id": "entry-late-refund", "event_type": "entry", "session_id": "session-late-refund",
         "occurred_at": "2026-11-02T05:00:00+00:00"},
        {"event_id": "payment-late-refund", "event_type": "payment", "session_id": "session-late-refund",
         "transaction_id": "txn-late-refund", "payment_status": "succeeded",
         "occurred_at": "2026-11-02T05:20:00+00:00"},
        {"event_id": "exit-late-refund", "event_type": "exit", "session_id": "session-late-refund",
         "occurred_at": "2026-11-02T06:00:00+00:00"},
        {"event_id": "refund-after-exit", "event_type": "payment", "session_id": "session-late-refund",
         "transaction_id": "txn-late-refund", "payment_status": "refunded",
         "occurred_at": "2026-11-02T06:10:00+00:00"},
    ]
    result = reconcile_events(rows)
    assert result["findings_total"] == 1
    assert result["findings"][0]["event_id"] == "exit-late-refund"
    assert result["findings"][0]["type"] == "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT"


def test_payment_after_exit_does_not_retroactively_pay_session():
    rows = [
        {"event_id": "entry-before-pay", "event_type": "entry", "session_id": "session-late-pay",
         "occurred_at": "2026-11-02T05:00:00+00:00"},
        {"event_id": "exit-before-pay", "event_type": "exit", "session_id": "session-late-pay",
         "occurred_at": "2026-11-02T06:00:00+00:00"},
        {"event_id": "payment-after-exit", "event_type": "payment", "session_id": "session-late-pay",
         "transaction_id": "txn-late-pay", "payment_status": "succeeded",
         "occurred_at": "2026-11-02T06:05:00+00:00"},
    ]
    result = reconcile_events(rows)
    assert result["findings_total"] == 1
    assert result["findings"][0]["event_id"] == "exit-before-pay"


def test_zero_charge_grace_session_does_not_require_payment():
    tariff = {
        "tariff_id": "free-grace-v1", "currency": "KZT", "rate_minor": 50000,
        "billing_increment_minutes": 30, "grace_minutes": 10,
        "max_charge_minor": None
    }
    rows = [
        {"event_id": "grace-entry", "event_type": "entry", "session_id": "grace-session",
         "tariff_id": "free-grace-v1", "tariff_snapshot": tariff,
         "occurred_at": "2026-11-02T05:00:00+00:00"},
        {"event_id": "grace-exit", "event_type": "exit", "session_id": "grace-session",
         "occurred_at": "2026-11-02T05:05:00+00:00"},
    ]
    result = reconcile_events(rows)
    assert result["findings_total"] == 0
    financial = result["financial_reconciliation"]
    assert financial["sessions_evaluated"] == 1
    assert financial["by_currency"]["KZT"]["expected_total_minor"] == 0
    assert financial["by_currency"]["KZT"]["exact_base_tariff"] == 1
