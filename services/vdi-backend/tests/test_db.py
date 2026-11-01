from types import SimpleNamespace
import app.db as db


def test_proof_chain_verifies_and_detects_tampering(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "settings", SimpleNamespace(
        database_path=str(tmp_path / "vdi.sqlite3"),
        token_secret="test-secret",
    ))
    db.init_db()
    for event_id in ("evt-1", "evt-2"):
        db.record_event(
            {
                "event_id": event_id,
                "source_id": "test-camera",
                "event_type": "plate_observed",
                "occurred_at": "2026-11-01T12:00:00+00:00",
                "ocr_confidence": 0.99,
            },
            {
                "normalized": "123ABC01",
                "status": "OBSERVED_VALID_FORMAT",
                "reason_code": "KZ_STANDARD_FORMAT_MATCH",
            },
        )

    assert db.verify_proof_chain() == {
        "ok": True, "checked": 2, "broken_event_id": None, "reason": "CHAIN_VALID"
    }

    with db.connect() as conn:
        conn.execute(
            "UPDATE proofs SET receipt_json=? WHERE event_id=?",
            ('{"tampered":true}', "evt-2"),
        )
    result = db.verify_proof_chain()
    assert result["ok"] is False
    assert result["broken_event_id"] == "evt-2"
    assert result["reason"] == "RECEIPT_HASH_MISMATCH"
