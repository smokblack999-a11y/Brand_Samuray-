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
        assert audit["findings"][0]["type"] == "EXIT_WITHOUT_RECORDED_PAYMENT"


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
