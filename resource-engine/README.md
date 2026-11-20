# SAMURAI Resource Engine — Foundation v0.2

A separate, local-first ingestion foundation for user-authorized exports and files.

## Safety boundary

- Telegram collection uses the official Telegram client protocol through Telethon and only chats accessible to the account you authenticate.
- No hidden/private data, account bypass, scraping of private interfaces, or collection from accounts you do not control or have permission to use.
- Telegram API credentials and the local session file stay on the device. Never commit them or share them.
- Imported messages are preserved locally. Relevance scoring adds signals; it never silently discards messages.
- Original records and SHA-256 digests are stored for provenance. Source chats are not modified.
- No cloud upload or background synchronization is implemented.
- The sync_outbox table is only a future queue placeholder. Do not assume cloud sync is active.

## Runtime

Python 3.11+; standard library core. Telethon is optional.

~~~~bash
cd resource-engine
python -m venv .venv
. .venv/bin/activate
pip install -e .
samurai-resource init
samurai-resource import-chatgpt /path/to/conversations.json
samurai-resource stats
~~~~

Install the Telegram connector only when needed:

~~~~bash
pip install -e '.[telegram]'
export TELEGRAM_API_ID='your_api_id'
export TELEGRAM_API_HASH='your_api_hash'
samurai-resource telegram-collect --chat '@your_chat' --account 'primary' --limit 0
~~~~

The first run asks Telethon to authenticate. The local session is saved under data/telegram_sessions; protect this folder like a password. The collector writes checkpoints under data/telegram_checkpoints and resumes from the last stored message ID. Use --limit 500 for a bounded first test. Add --media to download media into data/telegram_media; media downloads are off by default to avoid unexpectedly filling phone storage.

On Termux, keep the database, session, checkpoints, and media under the project's ignored data/ directory. Never paste API_HASH, login codes, passwords, or session contents into chat or GitHub.

## Current scope

- SQLite store for sources, ingestion runs, immutable objects, tags, and future sync outbox.
- ChatGPT conversations.json importer for common mapping -> message -> content.parts exports.
- Generic JSON record importer.
- Optional Telegram collector with chronological history traversal, per-chat checkpoint/resume, FloodWait pause/retry, and optional media download.
- Explainable relevance scoring (code, links, technical terms, long-form, media, reply context). It does not filter messages out.
- SHA-256 provenance and deterministic duplicate suppression.

## Known limitations

- Telegram coverage is limited to chats and history exposed to the authenticated account and Telegram API. Secret chats, deleted content, inaccessible channels, and server-side unavailable media cannot be recovered.
- Edits/deletions are not yet reconciled as change events; the collector is an append-only snapshot importer.
- Media files are stored separately on disk; the database stores their local path and metadata. Backup/export packaging is not yet implemented.
- No cloud encryption/key management, remote sync, vector search, knowledge graph, automatic summaries, UI/API, or production monitoring.
- ChatGPT export coverage is limited to the official archive contents supplied by the user.

## Hybrid storage design

Local SQLite is the system of record. A future sync worker may lease records from sync_outbox and send encrypted payloads to a configured destination. Before enabling that worker, implement client-side authenticated encryption, key rotation/recovery, explicit destination allowlisting, retry/backoff, deletion propagation policy, and sync receipts. No remote sync is active in v0.2.
