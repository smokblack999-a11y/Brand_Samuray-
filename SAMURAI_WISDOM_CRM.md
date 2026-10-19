# Samurai Wisdom CRM Ultimate

A single-file, local-first Python CLI for basic lead tracking, revenue/expense records, a SQLite audit trail, backups, and self-tests.

## Requirements
- Python 3.9+
- No third-party packages; no network access required

## Termux quick start
```sh
pkg update
pkg install python git
git clone https://github.com/smokblack999-a11y/Brand_Samuray-.git
cd Brand_Samuray-
git fetch origin
git switch samurai-wisdom-crm-ultimate
python samurai_launcher.py --self-test
python samurai_launcher.py
```

To run a non-interactive dashboard:
```sh
python samurai_launcher.py --dashboard
```

## Data and security
- Data defaults to `~/.samurai-wisdom/samurai_wisdom.sqlite3`; set `SAMURAI_HOME` or pass `--home /path` to change the data directory.
- SQLite uses foreign-key enforcement, WAL, and a busy timeout. Financial amounts are integer KZT; the net result is based only on entries the operator recorded.
- Backups are written under `backups/` in the data directory.
- Do not enter passwords, API tokens, card details, or sensitive personal data into CRM notes.
- The audit log is an application-level record, not tamper-proof or cryptographically signed.
- Telegram menu is configuration/status-only. This CLI does **not** send messages, receive webhooks, or claim to provide a Telegram user-account client. No token value is printed.
- This CLI does not yet connect to existing SamuraiOS Android, PostgreSQL/Redis, or Revenue Control Plane services. It is a standalone local MVP, not a replacement for those systems.
