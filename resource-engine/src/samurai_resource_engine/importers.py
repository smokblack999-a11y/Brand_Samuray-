"""Import user-provided exports. No network access or account scraping."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from .store import ResourceStore


def _parts_to_text(value: Any) -> str:
    chunks: list[str] = []
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for item in value:
            text = _parts_to_text(item)
            if text:
                chunks.append(text)
    elif isinstance(value, dict):
        if isinstance(value.get("text"), str):
            chunks.append(value["text"])
        elif "parts" in value:
            chunks.append(_parts_to_text(value["parts"]))
        elif "content" in value and isinstance(value["content"], (dict, list, str)):
            chunks.append(_parts_to_text(value["content"]))
    return "\n".join(x for x in chunks if x)


def _chatgpt_records(payload: Any) -> Iterable[dict[str, Any]]:
    conversations = payload.get("conversations") if isinstance(payload, dict) else payload
    if not isinstance(conversations, list):
        raise ValueError("Expected ChatGPT export JSON: a list or an object with 'conversations' list")

    for conversation_index, conversation in enumerate(conversations):
        if not isinstance(conversation, dict):
            continue
        conversation_id = str(conversation.get("id") or f"conversation-{conversation_index}")
        title = str(conversation.get("title") or "Untitled conversation")
        mapping = conversation.get("mapping")
        if isinstance(mapping, dict):
            for node_id, node in mapping.items():
                message = node.get("message") if isinstance(node, dict) else None
                if not isinstance(message, dict):
                    continue
                author = message.get("author") if isinstance(message.get("author"), dict) else {}
                content = message.get("content", {})
                message_id = str(message.get("id") or node_id)
                role = str(author.get("role") or "unknown")
                text = _parts_to_text(content)
                yield {
                    "external_id": f"{conversation_id}:{message_id}",
                    "object_type": "chatgpt_message",
                    "title": f"{title} — {role}",
                    "content_text": text,
                    "source_created_at": message.get("create_time"),
                    "raw": {
                        "conversation_id": conversation_id,
                        "conversation_title": title,
                        "node_id": node_id,
                        "message": message,
                    },
                }
        else:
            yield {
                "external_id": conversation_id,
                "object_type": "chatgpt_conversation",
                "title": title,
                "content_text": _parts_to_text(conversation.get("messages", [])),
                "source_created_at": conversation.get("create_time"),
                "raw": conversation,
            }


def import_chatgpt_export(path: str | Path, store: ResourceStore) -> dict[str, int | str]:
    path = Path(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    source_id = store.register_source("chatgpt-export", "chatgpt_export", "ChatGPT export")
    run_id = store.start_run(source_id, path.name)
    seen = inserted = duplicates = 0
    try:
        for item in _chatgpt_records(payload):
            seen += 1
            _, was_inserted = store.ingest_object(source_id, item)
            inserted += int(was_inserted)
            duplicates += int(not was_inserted)
        store.finish_run(run_id, seen=seen, inserted=inserted, duplicates=duplicates)
    except Exception as exc:
        store.finish_run(run_id, seen=seen, inserted=inserted, duplicates=duplicates, error=str(exc))
        raise
    return {"run_id": run_id, "seen": seen, "inserted": inserted, "duplicates": duplicates}


def import_json_records(path: str | Path, store: ResourceStore, source_key: str = "json-import") -> dict[str, int | str]:
    path = Path(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload if isinstance(payload, list) else [payload]
    source_id = store.register_source(source_key, "json", source_key)
    run_id = store.start_run(source_id, path.name)
    seen = inserted = duplicates = 0
    try:
        for index, record in enumerate(records):
            seen += 1
            raw = record if isinstance(record, dict) else {"value": record}
            item = {
                "external_id": str(raw.get("id") or f"{path.name}:{index}"),
                "object_type": "json_record",
                "title": str(raw.get("title") or raw.get("name") or ""),
                "content_text": _parts_to_text(raw),
                "raw": raw,
            }
            _, was_inserted = store.ingest_object(source_id, item)
            inserted += int(was_inserted)
            duplicates += int(not was_inserted)
        store.finish_run(run_id, seen=seen, inserted=inserted, duplicates=duplicates)
    except Exception as exc:
        store.finish_run(run_id, seen=seen, inserted=inserted, duplicates=duplicates, error=str(exc))
        raise
    return {"run_id": run_id, "seen": seen, "inserted": inserted, "duplicates": duplicates}
