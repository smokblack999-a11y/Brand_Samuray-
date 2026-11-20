"""Append-only SQLite store with provenance and a future sync outbox."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


class ResourceStore:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 30000")
        return conn

    def _initialize(self) -> None:
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sources (
                    id INTEGER PRIMARY KEY,
                    source_key TEXT NOT NULL UNIQUE,
                    source_type TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ingestion_runs (
                    id TEXT PRIMARY KEY,
                    source_id INTEGER NOT NULL REFERENCES sources(id),
                    input_name TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    objects_seen INTEGER NOT NULL DEFAULT 0,
                    objects_inserted INTEGER NOT NULL DEFAULT 0,
                    objects_duplicate INTEGER NOT NULL DEFAULT 0,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS objects (
                    id INTEGER PRIMARY KEY,
                    source_id INTEGER NOT NULL REFERENCES sources(id),
                    external_id TEXT NOT NULL,
                    object_type TEXT NOT NULL,
                    title TEXT,
                    content_text TEXT NOT NULL DEFAULT '',
                    source_created_at TEXT,
                    collected_at TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    raw_json TEXT NOT NULL,
                    normalized_json TEXT NOT NULL,
                    UNIQUE(source_id, external_id, sha256)
                );
                CREATE INDEX IF NOT EXISTS idx_objects_source_date
                    ON objects(source_id, source_created_at);
                CREATE INDEX IF NOT EXISTS idx_objects_type
                    ON objects(object_type);
                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS object_tags (
                    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY(object_id, tag_id)
                );
                CREATE TABLE IF NOT EXISTS sync_outbox (
                    id INTEGER PRIMARY KEY,
                    object_id INTEGER NOT NULL UNIQUE REFERENCES objects(id) ON DELETE CASCADE,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','leased','synced','failed')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)

    def register_source(self, source_key: str, source_type: str, display_name: str) -> int:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO sources(source_key,source_type,display_name,created_at)
                   VALUES(?,?,?,?)
                   ON CONFLICT(source_key) DO UPDATE SET
                     source_type=excluded.source_type,
                     display_name=excluded.display_name""",
                (source_key, source_type, display_name, utc_now()),
            )
            row = conn.execute("SELECT id FROM sources WHERE source_key=?", (source_key,)).fetchone()
            return int(row["id"])

    def start_run(self, source_id: int, input_name: str) -> str:
        import uuid
        run_id = str(uuid.uuid4())
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO ingestion_runs(id,source_id,input_name,status,started_at)
                   VALUES(?,?,?,'running',?)""",
                (run_id, source_id, input_name, utc_now()),
            )
        return run_id

    def finish_run(self, run_id: str, *, seen: int, inserted: int, duplicates: int,
                   error: str | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """UPDATE ingestion_runs SET status=?,finished_at=?,objects_seen=?,
                   objects_inserted=?,objects_duplicate=?,error=? WHERE id=?""",
                ("failed" if error else "completed", utc_now(), seen, inserted, duplicates,
                 error[:1000] if error else None, run_id),
            )

    def ingest_object(self, source_id: int, item: dict[str, Any]) -> tuple[int, bool]:
        raw_json = canonical_json(item.get("raw", item))
        digest = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
        normalized = {
            "external_id": str(item.get("external_id") or digest),
            "object_type": str(item.get("object_type") or "record"),
            "title": item.get("title"),
            "content_text": str(item.get("content_text") or ""),
            "source_created_at": item.get("source_created_at"),
            "raw_sha256": digest,
            "raw": item.get("raw", item),
        }
        with self.connect() as conn:
            cursor = conn.execute(
                """INSERT OR IGNORE INTO objects
                   (source_id,external_id,object_type,title,content_text,source_created_at,
                    collected_at,sha256,raw_json,normalized_json)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (source_id, normalized["external_id"], normalized["object_type"],
                 normalized["title"], normalized["content_text"],
                 normalized["source_created_at"], utc_now(), digest, raw_json,
                 canonical_json(normalized)),
            )
            if cursor.rowcount == 0:
                row = conn.execute(
                    "SELECT id FROM objects WHERE source_id=? AND external_id=? AND sha256=?",
                    (source_id, normalized["external_id"], digest),
                ).fetchone()
                return int(row["id"]), False
            object_id = int(cursor.lastrowid)
            conn.execute(
                "INSERT OR IGNORE INTO sync_outbox(object_id,status,created_at,updated_at) VALUES(?,'pending',?,?)",
                (object_id, utc_now(), utc_now()),
            )
            return object_id, True

    def stats(self) -> dict[str, int]:
        with self.connect() as conn:
            return {
                "sources": conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0],
                "objects": conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0],
                "runs": conn.execute("SELECT COUNT(*) FROM ingestion_runs").fetchone()[0],
                "pending_sync": conn.execute(
                    "SELECT COUNT(*) FROM sync_outbox WHERE status='pending'"
                ).fetchone()[0],
            }

    def list_objects(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT id,external_id,object_type,title,source_created_at,sha256
                   FROM objects ORDER BY id DESC LIMIT ?""",
                (max(1, min(int(limit), 500)),),
            ).fetchall()
            return [dict(row) for row in rows]
