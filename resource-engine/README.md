# SAMURAI Resource Engine — Foundation v0.1

A separate, local-first ingestion foundation for user-authorized exports and files.

## Safety boundary

- Imports only files explicitly supplied by the user or selected by the operator.
- Does not log in to accounts, scrape private interfaces, bypass access controls, or collect another person's private data.
- Does not modify source files.
- Keeps original imported record JSON and a SHA-256 digest for provenance.
- No cloud upload or background synchronization is implemented in this foundation.
- The `sync_outbox` table is only a durable queue placeholder for a future, explicitly configured encrypted sync adapter.
- Do not place API keys, session files, or raw exports in Git.

## Runtime

Python 3.11+; standard library only.

```bash
cd resource-engine
python -m venv .venv
. .venv/bin/activate
pip install -e .
samurai-resource init
samurai-resource import-chatgpt /path/to/conversations.json
samurai-resource stats
```

Without installation:

```bash
PYTHONPATH=src python -m samurai_resource_engine.cli --db ./data/resource.sqlite3 init
PYTHONPATH=src python -m samurai_resource_engine.cli --db ./data/resource.sqlite3 import-chatgpt /path/to/conversations.json
```

## Current scope

- SQLite schema for sources, ingestion runs, immutable imported objects, tags, and sync outbox.
- ChatGPT `conversations.json` importer for the common `mapping -> message -> content.parts` export shape.
- Generic JSON record importer.
- SHA-256 provenance and deterministic duplicate suppression.
- Import run accounting and resumable-by-reimport behavior (same records are deduplicated).

## Not yet implemented

- Telegram, GitHub, Gmail, cloud-drive or other live connectors.
- Cloud encryption/key management and remote sync.
- Full attachment/media extraction and binary object storage.
- Search/vector index, knowledge graph, automatic tagging, UI/API.
- A claim of complete account export. Coverage is limited to what the source's official export/API makes available.

## Hybrid storage design

Local SQLite is the system of record. A future sync worker may lease records from `sync_outbox` and send encrypted payloads to a configured destination. Before enabling that worker, implement client-side authenticated encryption, key rotation/recovery, explicit destination allowlisting, retry/backoff, deletion propagation policy, and sync receipts. No remote sync is active in v0.1.
