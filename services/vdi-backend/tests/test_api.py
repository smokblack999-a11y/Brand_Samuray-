from dataclasses import replace

from fastapi.testclient import TestClient
from app import db, main
from app.config import settings


def test_health():
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200


def test_reconcile_api_reports_exit_without_payment(tmp_path, monkeypatch):
    test_settings = replace(
        settings,
        api_key="test-api-key",
        token_secret="test-token-secret",
        database_path=str(tmp_path / "vdi-test.sqlite3"),
        enable_rtsp=False,
    )
    monkeypatch.setattr(db, "settings", test_settings)
    monkeypatch.setattr(main, "settings", test_settings)

    headers = {"X-API-Key": "test-api-key"}
    common = {
        "source_id": "test-parking",
        "plate_text": "123ABC01",
        "ocr_confidence": 0.99,
    }
    with TestClient(main.app) as client:
        entry = {
            **common,
            "event_id": "test-entry-001",
            "event_type": "entry",
            "occurred_at": "2026-11-02T08:00:00+00:00",
        }
        exit_event = {
            **common,
            "event_id": "test-exit-001",
            "event_type": "exit",
            "occurred_at": "2026-11-02T09:00:00+00:00",
        }
        assert client.post("/v1/events", json=entry, headers=headers).status_code == 200
        assert client.post("/v1/events", json=exit_event, headers=headers).status_code == 200

        response = client.get("/v1/audit/reconcile", headers=headers)
        assert response.status_code == 200
        audit = response.json()["audit"]
        assert audit["findings_total"] == 1
        assert audit["findings"][0]["type"] == "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT"


def test_payment_event_requires_amount():
    with TestClient(main.app) as client:
        response = client.post(
            "/v1/events",
            json={
                "source_id": "test-parking",
                "event_id": "payment-without-amount",
                "event_type": "payment",
                "occurred_at": "2026-11-02T09:30:00+00:00",
                "plate_text": "123ABC01",
                "ocr_confidence": 0.99,
            },
            headers={"X-API-Key": "not-configured"},
        )
        assert response.status_code == 422


def test_payment_event_accepts_provider_payload_without_ocr(tmp_path, monkeypatch):
    test_settings = replace(
        settings,
        api_key="test-api-key",
        token_secret="test-token-secret",
        database_path=str(tmp_path / "vdi-payment-test.sqlite3"),
        enable_rtsp=False,
    )
    monkeypatch.setattr(db, "settings", test_settings)
    monkeypatch.setattr(main, "settings", test_settings)
    headers = {"X-API-Key": "test-api-key"}
    with TestClient(main.app) as client:
        entry = {
            "source_id": "parking-system", "event_id": "session-entry-1",
            "event_type": "entry", "occurred_at": "2026-11-02T08:00:00+00:00",
            "session_id": "session-1"
        }
        payment = {
            "source_id": "payment-provider", "event_id": "provider-webhook-1",
            "event_type": "payment", "occurred_at": "2026-11-02T08:30:00+00:00",
            "session_id": "session-1", "provider_event_id": "evt_123",
            "transaction_id": "txn_123", "payment_status": "succeeded",
            "amount_minor": 500, "currency": "KZT"
        }
        exit_event = {
            "source_id": "parking-system", "event_id": "session-exit-1",
            "event_type": "exit", "occurred_at": "2026-11-02T09:00:00+00:00",
            "session_id": "session-1"
        }
        assert client.post("/v1/events", json=entry, headers=headers).status_code == 200
        payment_response = client.post("/v1/events", json=payment, headers=headers)
        assert payment_response.status_code == 200
        assert payment_response.json()["event"]["validation_status"] == "SESSION_LINKED"
        assert client.post("/v1/events", json=exit_event, headers=headers).status_code == 200
        audit = client.get("/v1/audit/reconcile", headers=headers).json()["audit"]
        assert audit["findings_total"] == 0
        stored = client.get("/v1/events", headers=headers).json()["events"]
        payment_row = next(row for row in stored if row["event_id"] == "provider-webhook-1")
        assert payment_row["payment_status"] == "succeeded"
        assert payment_row["ocr_confidence"] is None


def test_event_id_reuse_with_changed_payload_returns_conflict(tmp_path, monkeypatch):
    test_settings = replace(
        settings, api_key="test-api-key", token_secret="test-token-secret",
        database_path=str(tmp_path / "vdi-idempotency.sqlite3"), enable_rtsp=False,
    )
    monkeypatch.setattr(db, "settings", test_settings)
    monkeypatch.setattr(main, "settings", test_settings)
    headers = {"X-API-Key": "test-api-key"}
    event = {
        "source_id": "parking-A", "event_id": "same-id",
        "event_type": "entry", "occurred_at": "2026-11-02T08:00:00+00:00",
        "session_id": "session-A"
    }
    with TestClient(main.app) as client:
        first = client.post("/v1/events", json=event, headers=headers)
        exact_retry = client.post("/v1/events", json=event, headers=headers)
        collision = {**event, "source_id": "parking-B", "session_id": "session-B"}
        conflict = client.post("/v1/events", json=collision, headers=headers)
        assert first.status_code == 200
        assert exact_retry.status_code == 200
        assert exact_retry.json()["duplicate"] is True
        assert conflict.status_code == 409


def test_audit_reports_truncated_window_explicitly(tmp_path, monkeypatch):
    test_settings = replace(
        settings, api_key="test-api-key", token_secret="test-token-secret",
        database_path=str(tmp_path / "vdi-audit-window.sqlite3"), enable_rtsp=False,
    )
    monkeypatch.setattr(db, "settings", test_settings)
    monkeypatch.setattr(main, "settings", test_settings)
    headers = {"X-API-Key": "test-api-key"}
    with TestClient(main.app) as client:
        for number in range(2):
            event = {
                "source_id": "parking", "event_id": f"window-{number}",
                "event_type": "entry", "occurred_at": f"2026-11-02T0{8+number}:00:00+00:00",
                "session_id": f"session-{number}"
            }
            assert client.post("/v1/events", json=event, headers=headers).status_code == 200
        response = client.get("/v1/audit/reconcile?limit=1", headers=headers)
        assert response.status_code == 200
        audit = response.json()["audit"]
        assert audit["events_examined"] == 1
        assert audit["events_available"] == 2
        assert audit["complete"] is False
        assert audit["warning"]


def test_tariff_api_reconciles_recorded_payment_against_configured_rule(tmp_path, monkeypatch):
    test_settings = replace(
        settings, api_key="test-api-key", token_secret="test-token-secret",
        database_path=str(tmp_path / "vdi-tariff-test.sqlite3"), enable_rtsp=False,
    )
    monkeypatch.setattr(db, "settings", test_settings)
    monkeypatch.setattr(main, "settings", test_settings)
    headers = {"X-API-Key": "test-api-key"}
    with TestClient(main.app) as client:
        tariff = {
            "tariff_id": "pilot-30m-v1", "currency": "KZT", "rate_minor": 50000,
            "billing_increment_minutes": 30, "grace_minutes": 10,
            "max_charge_minor": 150000
        }
        created = client.post("/v1/tariffs", json=tariff, headers=headers)
        assert created.status_code == 201
        assert client.post("/v1/tariffs", json=tariff, headers=headers).status_code == 409

        entry = {
            "source_id": "parking", "event_id": "tariff-entry",
            "event_type": "entry", "occurred_at": "2026-11-02T08:00:00+00:00",
            "session_id": "tariff-session", "tariff_id": "pilot-30m-v1"
        }
        payment = {
            "source_id": "payments", "event_id": "tariff-payment",
            "event_type": "payment", "occurred_at": "2026-11-02T08:20:00+00:00",
            "session_id": "tariff-session", "provider_event_id": "provider-tariff-1",
            "payment_status": "succeeded", "amount_minor": 25000, "currency": "KZT"
        }
        exit_event = {
            "source_id": "parking", "event_id": "tariff-exit",
            "event_type": "exit", "occurred_at": "2026-11-02T08:40:00+00:00",
            "session_id": "tariff-session"
        }
        assert client.post("/v1/events", json=entry, headers=headers).status_code == 200
        assert client.post("/v1/events", json=payment, headers=headers).status_code == 200
        assert client.post("/v1/events", json=exit_event, headers=headers).status_code == 200

        # Even if an operator edits the live tariff table directly, this session
        # must continue using the tariff snapshot captured at entry.
        with db.connect() as conn:
            conn.execute("UPDATE tariffs SET rate_minor=99999 WHERE tariff_id=?", ("pilot-30m-v1",))

        audit = client.get("/v1/audit/reconcile", headers=headers).json()["audit"]
        financial = audit["financial_reconciliation"]
        assert financial["sessions_evaluated"] == 1
        assert financial["by_currency"]["KZT"]["expected_total_minor"] == 50000
        assert financial["by_currency"]["KZT"]["recorded_paid_total_minor"] == 25000
        assert financial["by_currency"]["KZT"]["under_base_tariff"] == 1
        assert audit["financial_findings"][0]["type"] == "RECORDED_PAYMENT_BELOW_CONFIGURED_BASE_TARIFF"
        proof_check = client.get("/v1/proof-chain/verify", headers=headers)
        assert proof_check.status_code == 200
        assert proof_check.json()["reason"] == "CHAIN_AND_RECORDS_VALID"


def test_ticket_id_correlates_vehicle_and_payment_events(tmp_path, monkeypatch):
    test_settings = replace(
        settings, api_key="test-api-key", token_secret="test-token-secret",
        database_path=str(tmp_path / "vdi-ticket-test.sqlite3"), enable_rtsp=False,
    )
    monkeypatch.setattr(db, "settings", test_settings)
    monkeypatch.setattr(main, "settings", test_settings)
    headers = {"X-API-Key": "test-api-key"}
    with TestClient(main.app) as client:
        events = [
            {"source_id":"parking","event_id":"ticket-entry","event_type":"entry",
             "occurred_at":"2026-11-02T08:00:00+00:00","ticket_id":"ticket-42"},
            {"source_id":"payments","event_id":"ticket-payment","event_type":"payment",
             "occurred_at":"2026-11-02T08:20:00+00:00","ticket_id":"ticket-42",
             "provider_event_id":"ticket-pay-evt","payment_status":"succeeded",
             "amount_minor":50000,"currency":"KZT"},
            {"source_id":"parking","event_id":"ticket-exit","event_type":"exit",
             "occurred_at":"2026-11-02T08:40:00+00:00","ticket_id":"ticket-42"},
        ]
        for event in events:
            response = client.post("/v1/events", json=event, headers=headers)
            assert response.status_code == 200
        audit = client.get("/v1/audit/reconcile", headers=headers).json()["audit"]
        assert audit["findings_total"] == 0
        assert audit["financial_reconciliation"]["sessions_without_tariff"] == 1
