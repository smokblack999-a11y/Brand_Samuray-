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
          crop_sha256 TEXT,
          amount_minor INTEGER,
          currency TEXT NOT NULL DEFAULT 'KZT',
          session_id TEXT,
          ticket_id TEXT,
          tariff_id TEXT,
          provider_event_id TEXT,
          transaction_id TEXT,
          payment_status TEXT,
          payload_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at DESC);
        CREATE INDEX IF NOT EXISTS idx_events_plate_time ON events(plate_token, occurred_at);
        CREATE TABLE IF NOT EXISTS tariffs (
          tariff_id TEXT PRIMARY KEY,
          currency TEXT NOT NULL,
          rate_minor INTEGER NOT NULL CHECK(rate_minor >= 0),
          billing_increment_minutes INTEGER NOT NULL CHECK(billing_increment_minutes > 0),
          grace_minutes INTEGER NOT NULL CHECK(grace_minutes >= 0),
          max_charge_minor INTEGER CHECK(max_charge_minor IS NULL OR max_charge_minor >= 0),
          created_at TEXT NOT NULL
        );
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
        columns = {row["name"] for row in c.execute("PRAGMA table_info(events)").fetchall()}
        if "amount_minor" not in columns:
            c.execute("ALTER TABLE events ADD COLUMN amount_minor INTEGER")
        if "currency" not in columns:
            c.execute("ALTER TABLE events ADD COLUMN currency TEXT NOT NULL DEFAULT 'KZT'")
        for name in ("session_id", "ticket_id", "tariff_id", "provider_event_id", "transaction_id", "payment_status", "payload_hash"):
            if name not in columns:
                c.execute("ALTER TABLE events ADD COLUMN " + name + " TEXT")
        c.execute("CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, occurred_at)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_events_ticket_time ON events(ticket_id, occurred_at)")


def plate_token(plate: str) -> str:
    if not settings.token_secret:
        raise RuntimeError("PLATE_TOKEN_SECRET is required")
    return hmac.new(settings.token_secret.encode(), plate.encode(), hashlib.sha256).hexdigest()


def mask_plate(plate: str) -> str:
    if len(plate) < 4:
        return "*" * len(plate)
    return plate[:3] + "*" * max(0, len(plate)-5) + plate[-2:]


class EventConflict(Exception):
    """An event ID was reused with a different source or payload."""


def record_event(data: dict, validation: dict, crop_sha256: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    plate = validation.get("normalized", "")
    token = plate_token(plate) if plate else None
    masked = mask_plate(plate) if plate else None
    decision_id = "dec_" + hashlib.sha256(data["event_id"].encode()).hexdigest()[:24]
    decision = "LINKED" if validation["status"] == "SESSION_LINKED" else ("OBSERVED" if validation["status"] == "OBSERVED_VALID_FORMAT" else "REVIEW")
    policy_version = "session-link-v1" if validation["status"] == "SESSION_LINKED" else "kz-format-v1"
    amount_minor = data.get("amount_minor")
    currency = data.get("currency", "KZT")
    session_id = data.get("session_id")
    ticket_id = data.get("ticket_id")
    tariff_id = data.get("tariff_id")
    provider_event_id = data.get("provider_event_id")
    transaction_id = data.get("transaction_id")
    payment_status = data.get("payment_status")
    canonical_input = {"data": data, "validation": validation, "crop_sha256": crop_sha256}
    payload_hash = hashlib.sha256(json.dumps(canonical_input, sort_keys=True, separators=(",",":"), default=str).encode()).hexdigest()
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        existing = c.execute("SELECT * FROM events WHERE event_id=?", (data["event_id"],)).fetchone()
        if existing:
            if existing["source_id"] != data["source_id"] or existing["payload_hash"] != payload_hash:
                raise EventConflict("event_id was already used by this or another source with a different payload")
            d = c.execute("SELECT * FROM decisions WHERE event_id=?", (data["event_id"],)).fetchone()
            p = c.execute("SELECT * FROM proofs WHERE event_id=?", (data["event_id"],)).fetchone()
            return dict(existing), dict(d) if d else None, dict(p) if p else None, True
        c.execute("""INSERT INTO events(
          event_id,source_id,event_type,occurred_at,received_at,plate_token,plate_masked,
          ocr_confidence,validation_status,reason_code,crop_sha256,amount_minor,currency,
          session_id,ticket_id,tariff_id,provider_event_id,transaction_id,payment_status,payload_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (data["event_id"], data["source_id"], data.get("event_type","plate_observed"),
         data["occurred_at"], now, token, masked, data.get("ocr_confidence"),
         validation["status"], validation["reason_code"], crop_sha256, amount_minor, currency,
         session_id,ticket_id,tariff_id,provider_event_id,transaction_id,payment_status,payload_hash))
        c.execute("INSERT INTO decisions VALUES(?,?,?,?,?,?)",
        (decision_id, data["event_id"], decision, validation["reason_code"], policy_version, now))
        previous = c.execute("SELECT receipt_hash FROM proofs ORDER BY id DESC LIMIT 1").fetchone()
        previous_hash = previous["receipt_hash"] if previous else "GENESIS"
        receipt = {
            "schema_version":"vdi.proof.v1", "event_id":data["event_id"], "source_id":data["source_id"],
            "event_type":data.get("event_type","plate_observed"), "occurred_at":data["occurred_at"],
            "received_at":now, "plate_token":token, "plate_masked":masked,
            "validation_status":validation["status"], "decision":decision,
            "reason_code":validation["reason_code"], "amount_minor":amount_minor,
            "currency":currency, "session_id":session_id, "ticket_id":ticket_id, "tariff_id":tariff_id,
            "provider_event_id":provider_event_id, "transaction_id":transaction_id,
            "payment_status":payment_status, "payload_hash":payload_hash, "policy_version":policy_version, "previous_hash":previous_hash
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


def list_audit_events(limit=5000):
    # Take the newest bounded window first, then sort it chronologically.
    with connect() as c:
        rows = c.execute("""SELECT * FROM (
          SELECT event_id,event_type,occurred_at,plate_token,plate_masked,amount_minor,currency,
                 source_id,session_id,ticket_id,tariff_id,payment_status
          FROM events
          WHERE plate_token IS NOT NULL OR session_id IS NOT NULL OR ticket_id IS NOT NULL
          ORDER BY id DESC LIMIT ?
        ) ORDER BY occurred_at ASC""",
        (max(1, min(int(limit), 10000)),)).fetchall()
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
    """Verify receipt hashes and that current event/decision rows match their receipts."""
    checked = 0
    expected_previous = "GENESIS"
    with connect() as c:
        rows = c.execute("""
          SELECT p.event_id AS proof_event_id,p.previous_hash,p.receipt_json,p.receipt_hash,
                 e.source_id,e.event_type,e.occurred_at,e.plate_token,e.plate_masked,
                 e.validation_status,e.reason_code,e.amount_minor,e.currency,e.session_id,
                 e.ticket_id,e.tariff_id,e.provider_event_id,e.transaction_id,e.payment_status,e.payload_hash,
                 d.decision
          FROM proofs p
          LEFT JOIN events e ON e.event_id=p.event_id
          LEFT JOIN decisions d ON d.event_id=p.event_id
          ORDER BY p.id ASC
        """).fetchall()
    receipt_fields = (
        "source_id", "event_type", "occurred_at", "plate_token", "plate_masked",
        "validation_status", "reason_code", "amount_minor", "currency", "session_id",
        "ticket_id", "tariff_id", "provider_event_id", "transaction_id", "payment_status", "payload_hash",
    )
    for row in rows:
        if row["previous_hash"] != expected_previous:
            return {"ok": False, "checked": checked, "broken_event_id": row["proof_event_id"], "reason": "PREVIOUS_HASH_MISMATCH"}
        try:
            receipt = json.loads(row["receipt_json"])
            canonical = json.dumps(receipt, sort_keys=True, separators=(",",":"))
        except (TypeError, ValueError):
            return {"ok": False, "checked": checked, "broken_event_id": row["proof_event_id"], "reason": "INVALID_RECEIPT_JSON"}
        calculated = hashlib.sha256((expected_previous + canonical).encode()).hexdigest()
        if not hmac.compare_digest(calculated, row["receipt_hash"]):
            return {"ok": False, "checked": checked, "broken_event_id": row["proof_event_id"], "reason": "RECEIPT_HASH_MISMATCH"}
        if row["source_id"] is None or row["decision"] is None:
            return {"ok": False, "checked": checked, "broken_event_id": row["proof_event_id"], "reason": "MISSING_EVENT_OR_DECISION"}
        for field in receipt_fields:
            # Legacy receipts predate payload_hash; verify every field they actually contain.
            if field in receipt and receipt[field] != row[field]:
                return {"ok": False, "checked": checked, "broken_event_id": row["proof_event_id"], "reason": "EVENT_RECEIPT_MISMATCH"}
        if receipt.get("decision") != row["decision"]:
            return {"ok": False, "checked": checked, "broken_event_id": row["proof_event_id"], "reason": "DECISION_RECEIPT_MISMATCH"}
        expected_previous = row["receipt_hash"]
        checked += 1
    return {"ok": True, "checked": checked, "broken_event_id": None, "reason": "CHAIN_AND_RECORDS_VALID"}


def metrics():
    with connect() as c:
        return {
          "events_total": c.execute("SELECT COUNT(*) FROM events").fetchone()[0],
          "review_total": c.execute("SELECT COUNT(*) FROM events WHERE validation_status='REVIEW'").fetchone()[0],
          "valid_format_total": c.execute("SELECT COUNT(*) FROM events WHERE validation_status='OBSERVED_VALID_FORMAT'").fetchone()[0],
          "entry_total": c.execute("SELECT COUNT(*) FROM events WHERE event_type='entry'").fetchone()[0],
          "exit_total": c.execute("SELECT COUNT(*) FROM events WHERE event_type='exit'").fetchone()[0],
          "payment_total": c.execute("SELECT COUNT(*) FROM events WHERE event_type='payment'").fetchone()[0]
        }


def audit_event_count():
    with connect() as c:
        return c.execute(
            "SELECT COUNT(*) FROM events WHERE plate_token IS NOT NULL OR session_id IS NOT NULL"
        ).fetchone()[0]


def create_tariff(rule: dict):
    now = datetime.now(timezone.utc).isoformat()
    with connect() as c:
        c.execute(
            """INSERT INTO tariffs(tariff_id,currency,rate_minor,billing_increment_minutes,
               grace_minutes,max_charge_minor,created_at) VALUES(?,?,?,?,?,?,?)""",
            (rule["tariff_id"], rule["currency"], rule["rate_minor"],
             rule["billing_increment_minutes"], rule["grace_minutes"],
             rule.get("max_charge_minor"), now),
        )
        row = c.execute("SELECT * FROM tariffs WHERE tariff_id=?", (rule["tariff_id"],)).fetchone()
        return dict(row)


def get_tariff(tariff_id: str):
    with connect() as c:
        row = c.execute("SELECT * FROM tariffs WHERE tariff_id=?", (tariff_id,)).fetchone()
        return dict(row) if row else None


def list_tariffs():
    with connect() as c:
        rows = c.execute("SELECT * FROM tariffs ORDER BY created_at DESC").fetchall()
        return [dict(row) for row in rows]
