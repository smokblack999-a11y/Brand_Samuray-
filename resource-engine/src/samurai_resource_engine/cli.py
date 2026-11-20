"""Command line entry point."""
from __future__ import annotations

import argparse
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
    args = parser.parse_args()

    store = ResourceStore(args.db)
    if args.command == "init":
        result = {"initialized": True, "database": args.db}
    elif args.command == "stats":
        result = store.stats()
    elif args.command == "import-chatgpt":
        result = import_chatgpt_export(args.file, store)
    else:
        result = import_json_records(args.file, store, args.source_key)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
