"""Optional Telethon collector for chats the authenticated account can access.

Every message is archived locally; value scoring adds tags but never discards data.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

from .store import ResourceStore

log = logging.getLogger("samurai-resource.telegram")
KEYWORDS = (
    "api", "config", "function", "import", "ошибка", "ошибк", "настройк",
    "сервер", "тест", "сборк", "github", "termux", "android", "database",
    "sqlite", "token", "webhook", "deploy", "commit", "branch", "ошибка",
)
URL_RE = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)


def clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "").strip()


def assess_value(text: str, *, has_media: bool = False, reply_to: int | None = None) -> dict[str, Any]:
    """Return explainable relevance signals; do not use this to drop messages."""
    lowered = text.lower()
    signals: list[str] = []
    if "```" in text or re.search(r"^\s{4,}\S", text, re.MULTILINE):
        signals.append("code")
    if URL_RE.search(text):
        signals.append("link")
    hits = sorted({word for word in KEYWORDS if word in lowered})
    if hits:
        signals.append("technical_terms")
    if len(text) >= 500:
        signals.append("long_form")
    if has_media:
        signals.append("media")
    if reply_to:
        signals.append("reply_context")
    score = min(100, len(signals) * 20 + min(len(hits) * 3, 15))
    return {"score": score, "signals": signals, "matched_terms": hits}


def _checkpoint_path(directory: Path, account: str, chat_id: str) -> Path:
    key = hashlib.sha256(f"{account}:{chat_id}".encode()).hexdigest()[:24]
    return directory / f"{key}.json"


def _read_checkpoint(path: Path) -> int:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return max(0, int(data.get("last_message_id", 0)))
    except FileNotFoundError:
        return 0
    except (ValueError, TypeError, json.JSONDecodeError):
        raise RuntimeError(f"Checkpoint is damaged; inspect it before continuing: {path}")


def _write_checkpoint(path: Path, message_id: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"last_message_id": message_id}, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)


async def collect_telegram(
    *,
    api_id: int,
    api_hash: str,
    chat: str,
    account: str,
    store: ResourceStore,
    session_dir: str | Path = "data/telegram_sessions",
    checkpoint_dir: str | Path = "data/telegram_checkpoints",
    media_dir: str | Path = "data/telegram_media",
    download_media: bool = False,
    limit: int = 0,
) -> dict[str, int | str]:
    """Collect accessible chat history. limit=0 means all available history."""
    try:
        from telethon import TelegramClient, errors
    except ImportError as exc:
        raise RuntimeError("Install optional dependency: pip install 'samurai-resource-engine[telegram]'") from exc

    if not api_hash or not chat or not account:
        raise ValueError("api_hash, chat and account are required")
    session_root = Path(session_dir)
    session_root.mkdir(parents=True, exist_ok=True)
    os.chmod(session_root, 0o700)
    session_path = session_root / re.sub(r"[^a-zA-Z0-9_.-]", "_", account)
    checkpoint_root = Path(checkpoint_dir)
    media_root = Path(media_dir)
    client = TelegramClient(str(session_path), api_id, api_hash, flood_sleep_threshold=60)
    seen = inserted = duplicates = media_saved = 0
    try:
        await client.start()
        for candidate in session_root.glob(session_path.name + ".session*"):
            try:
                os.chmod(candidate, 0o600)
            except OSError:
                log.warning("Could not restrict permissions on session file: %s", candidate.name)

        entity = await client.get_entity(chat)
        chat_id = str(getattr(entity, "id", chat))
        source_id = store.register_source(
            f"telegram:{account}:{chat_id}", "telegram_user_export",
            f"Telegram {account} / {getattr(entity, 'title', None) or chat_id}",
        )
        checkpoint = _checkpoint_path(checkpoint_root, account, chat_id)
        last_id = _read_checkpoint(checkpoint)
        run_id = store.start_run(source_id, f"telegram:{chat_id}")
        remaining = limit if limit > 0 else None

        try:
            while remaining is None or remaining > 0:
                try:
                    async for message in client.iter_messages(
                        entity, limit=remaining, min_id=last_id, reverse=True
                    ):
                        msg_id = int(message.id)
                        text = clean_text(getattr(message, "message", None) or getattr(message, "text", None))
                        media = getattr(message, "media", None)
                        reply_to = getattr(getattr(message, "reply_to", None), "reply_to_msg_id", None)
                        media_path = None
                        if download_media and media:
                            media_root.mkdir(parents=True, exist_ok=True)
                            os.chmod(media_root, 0o700)
                            target = media_root / f"{chat_id}_{msg_id}_{uuid.uuid4().hex[:8]}"
                            try:
                                saved = await client.download_media(message, file=str(target))
                                if saved:
                                    media_path = str(saved)
                                    media_saved += 1
                            except errors.FloodWaitError:
                                raise
                            except Exception:
                                log.exception("Media download failed for message %s; metadata will still be saved", msg_id)

                        relevance = assess_value(text, has_media=bool(media), reply_to=reply_to)
                        date = getattr(message, "date", None)
                        raw = {
                            "chat_id": chat_id,
                            "message_id": msg_id,
                            "sender_id": getattr(message, "sender_id", None),
                            "date": date.isoformat() if date else None,
                            "edit_date": getattr(message, "edit_date", None).isoformat() if getattr(message, "edit_date", None) else None,
                            "reply_to_message_id": reply_to,
                            "text": text,
                            "has_media": bool(media),
                            "media_type": type(media).__name__ if media else None,
                            "media_local_path": media_path,
                            "outgoing": bool(getattr(message, "out", False)),
                            "views": getattr(message, "views", None),
                            "forwards": getattr(message, "forwards", None),
                        }
                        item = {
                            "external_id": f"{chat_id}:{msg_id}",
                            "object_type": "telegram_message",
                            "title": f"Telegram {chat_id} / message {msg_id}",
                            "content_text": text,
                            "source_created_at": date.isoformat() if date else None,
                            "raw": raw,
                        }
                        _, was_inserted = store.ingest_object(source_id, item)
                        seen += 1
                        inserted += int(was_inserted)
                        duplicates += int(not was_inserted)
                        # Checkpoint after every successfully persisted message. If interrupted,
                        # a retry resumes from the last committed message ID.
                        last_id = msg_id
                        _write_checkpoint(checkpoint, last_id)
                        remaining = remaining - 1 if remaining is not None else None
                        if remaining == 0:
                            break
                    else:
                        break
                    if remaining == 0:
                        break
                except errors.FloodWaitError as exc:
                    wait_seconds = max(1, int(exc.seconds)) + 1
                    log.warning("Telegram FloodWait: sleeping %s seconds; checkpoint=%s", wait_seconds, last_id)
                    await asyncio.sleep(wait_seconds)
                    continue
            store.finish_run(run_id, seen=seen, inserted=inserted, duplicates=duplicates)
        except Exception as exc:
            store.finish_run(run_id, seen=seen, inserted=inserted, duplicates=duplicates, error=str(exc))
            raise
        return {
            "run_id": run_id, "chat_id": chat_id, "seen_this_run": seen,
            "inserted": inserted, "duplicates": duplicates, "media_saved": media_saved,
            "last_message_id": last_id, "checkpoint": str(checkpoint),
        }
    finally:
        await client.disconnect()
