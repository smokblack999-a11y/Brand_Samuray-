"Command line entry point."
from __future__ import annotations

import argparse
import asyncio
import json
import os

from .importers import import_chatgpt_export, import_json_records
from .store import ResourceStore


def main() -> None:
    parser = argparse.ArgumentParser(prog="samurai-resource")
    parser.add_argument("--db", default=os.environ.get("SAMURAI_RESOURCE_DB", "data/resource-engine.sqlite3"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Create the local resource database")
    sub.add_parser("stats", help="Show local database counters")
    chatgpt = sub.add_parser("import-chatgpt", help="Import a ChatGPT conversations.json export")
    chatgpt.add_argument("file")
    generic = sub.add_parser("import-json", help="Import a JSON file or array of JSON records")
    generic.add_argument("file")
    generic.add_argument("--source-key", default="json-import")

    telegram = sub.add_parser("telegram-collect", help="Collect history from a Telegram chat accessible to your account")
    telegram.add_argument("--chat", required=True, help="Chat username, link, or numeric ID")
    telegram.add_argument("--account", default="primary", help="Local account/session label")
    telegram.add_argument("--limit", type=int, default=0, help="Maximum messages this run; 0 means all available history")
    telegram.add_argument("--media", action="store_true", help="Download media files into the local vault")
    telegram.add_argument("--session-dir", default="data/telegram_sessions")
    telegram.add_argument("--checkpoint-dir", default="data/telegram_checkpoints")
    telegram.add_argument("--media-dir", default="data/telegram_media")
    args = parser.parse_args()

    store = ResourceStore(args.db)
    if args.command == "init":
        result = {"initialized": True, "database": args.db}
    elif args.command == "stats":
        result = store.stats()
    elif args.command == "import-chatgpt":
        result = import_chatgpt_export(args.file, store)
    elif args.command == "import-json":
        result = import_json_records(args.file, store, args.source_key)
    else:
        api_id = os.environ.get("TELEGRAM_API_ID")
        api_hash = os.environ.get("TELEGRAM_API_HASH")
        if not api_id or not api_hash:
            parser.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in the local environment; never commit them.")
        if args.limit < 0:
            parser.error("--limit must be 0 or greater")
        from .telegram import collect_telegram
        result = asyncio.run(collect_telegram(
            api_id=int(api_id), api_hash=api_hash, chat=args.chat,
            account=args.account, store=store, session_dir=args.session_dir,
            checkpoint_dir=args.checkpoint_dir, media_dir=args.media_dir,
            download_media=args.media, limit=args.limit,
        ))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
