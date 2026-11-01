import hashlib
import hmac
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from .config import settings

def connect():
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    with connect() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          source_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          plate_token TEXT,
          plate_masked TEXT,
          ocr_confidence REAL,
          validation_status TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          crop_sha256 TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at DESC);
        CREATE TABLE IF NOT EXISTS decisions (
          decision_id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
          decision TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          evaluated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proofs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
          previous_hash TEXT,
          receipt_json TEXT NOT NULL,
          receipt_hash TEXT NOT NULL UNIQUE
        );
        """)

def plate_token(plate: str) -> str:
    if not settings.token_secret:
        raise RuntimeError("PLATE_TOKEN_SECRET is required")
    return hmac.new(settings.token_secret.encode(), plate.encode(), hashlib.sha256).hexdigest()

def mask_plate(plate: str) -> str:
    if len(plate) < 4:
        return "*" * len(plate)
    return plate[:3] + "*" * max(0, len(plate)-5) + plate[-2:]

def record_event(data: dict, validation: dict, crop_sha256: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    plate = validation.get("normalized", "")
    token = plate_token(plate) if plate else None
    masked = mask_plate(plate) if plate else None
    decision_id = "dec_" + hashlib.sha256(data["event_id"].encode()).hexdigest()[:24]
    decision = "OBSERVED" if validation["status"] == "OBSERVED_VALID_FORMAT" else "REVIEW"
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        existing = c.execute("SELECT * FROM events WHERE event_id=?", (data["event_id"],)).fetchone()
        if existing:
            d = c.execute("SELECT * FROM decisions WHERE event_id=?", (data["event_id"],)).fetchone()
            p = c.execute("SELECT * FROM proofs WHERE event_id=?", (data["event_id"],)).fetchone()
            return dict(existing), dict(d) if d else None, dict(p) if p else None, True
        c.execute("""INSERT INTO events(event_id,source_id,event_type,occurred_at,received_at,plate_token,plate_masked,ocr_confidence,validation_status,reason_code,crop_sha256)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (data["event_id"], data["source_id"], data.get("event_type","plate_observed"), data["occurred_at"], now, token, masked, data.get("ocr_confidence"), validation["status"], validation["reason_code"], crop_sha256))
        c.execute("INSERT INTO decisions VALUES(?,?,?,?,?,?)",
        (decision_id, data["event_id"], decision, validation["reason_code"], "kz-format-v1", now))
        previous = c.execute("SELECT receipt_hash FROM proofs ORDER BY id DESC LIMIT 1").fetchone()
        previous_hash = previous["receipt_hash"] if previous else "GENESIS"
        receipt = {
            "schema_version":"vdi.proof.v1", "event_id":data["event_id"], "source_id":data["source_id"],
            "occurred_at":data["occurred_at"], "received_at":now, "plate_token":token,
            "plate_masked":masked, "validation_status":validation["status"],
            "decision":decision, "reason_code":validation["reason_code"],
            "policy_version":"kz-format-v1", "previous_hash":previous_hash
        }
        receipt_json = json.dumps(receipt, sort_keys=True, separators=(",",":"))
        receipt_hash = hashlib.sha256((previous_hash + receipt_json).encode()).hexdigest()
        c.execute("INSERT INTO proofs(event_id,previous_hash,receipt_json,receipt_hash) VALUES(?,?,?,?)",
                  (data["event_id"], previous_hash, receipt_json, receipt_hash))
        event = c.execute("SELECT * FROM events WHERE event_id=?", (data["event_id"],)).fetchone()
        decision_row = c.execute("SELECT * FROM decisions WHERE event_id=?", (data["event_id"],)).fetchone()
        proof_row = c.execute("SELECT * FROM proofs WHERE event_id=?", (data["event_id"],)).fetchone()
        return dict(event), dict(decision_row), dict(proof_row), False

def list_events(limit=50):
    with connect() as c:
        rows = c.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (max(1,min(int(limit),200)),)).fetchall()
        return [dict(r) for r in rows]

def get_event(event_id):
    with connect() as c:
        e=c.execute("SELECT * FROM events WHERE event_id=?", (event_id,)).fetchone()
        if not e: return None
        d=c.execute("SELECT * FROM decisions WHERE event_id=?", (event_id,)).fetchone()
        return {"event":dict(e), "decision":dict(d) if d else None}

def get_proof(event_id):
    with connect() as c:
        r=c.execute("SELECT * FROM proofs WHERE event_id=?", (event_id,)).fetchone()
        return dict(r) if r else None

def verify_proof_chain():
    """Verify every local receipt link and its canonical JSON hash."""
    checked = 0
    expected_previous = "GENESIS"
    with connect() as c:
        rows = c.execute("SELECT event_id, previous_hash, receipt_json, receipt_hash FROM proofs ORDER BY id ASC").fetchall()
    for row in rows:
        if row["previous_hash"] != expected_previous:
            return {"ok": False, "checked": checked, "broken_event_id": row["event_id"], "reason": "PREVIOUS_HASH_MISMATCH"}
        try:
            receipt = json.loads(row["receipt_json"])
            canonical = json.dumps(receipt, sort_keys=True, separators=(",",":"))
        except (TypeError, ValueError):
            return {"ok": False, "checked": checked, "broken_event_id": row["event_id"], "reason": "INVALID_RECEIPT_JSON"}
        calculated = hashlib.sha256((expected_previous + canonical).encode()).hexdigest()
        if not hmac.compare_digest(calculated, row["receipt_hash"]):
            return {"ok": False, "checked": checked, "broken_event_id": row["event_id"], "reason": "RECEIPT_HASH_MISMATCH"}
        expected_previous = row["receipt_hash"]
        checked += 1
    return {"ok": True, "checked": checked, "broken_event_id": None, "reason": "CHAIN_VALID"}

def metrics():
    with connect() as c:
        return {
          "events_total": c.execute("SELECT COUNT(*) FROM events").fetchone()[0],
          "review_total": c.execute("SELECT COUNT(*) FROM events WHERE validation_status='REVIEW'").fetchone()[0],
          "valid_format_total": c.execute("SELECT COUNT(*) FROM events WHERE validation_status='OBSERVED_VALID_FORMAT'").fetchone()[0]
        }
