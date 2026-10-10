# Security boundary

## Sensitive data

The following must never be committed, logged, attached to analytics, or sent to the host backend:

- Telegram login codes and cloud passwords
- API secrets/private credentials
- TDLib database, encryption key and session files
- Full message contents unless the user explicitly enables a feature that needs them

## Storage

- Use a separate private TDLib database and files directory per account.
- Generate/store the TDLib database encryption key using platform secure storage; never hardcode it.
- Exclude session databases and media caches from Android cloud/device backups unless an explicit, reviewed recovery design says otherwise.
- Logout must close TDLib cleanly before optional deletion of local session data.

## Logging

- Log event types, elapsed time, safe error categories and correlation IDs only.
- Redact phone numbers, access tokens, message text, file paths and authorization payloads.
- Do not log raw TDLib JSON updates in production.

## Network and trust

- Use the official TDLib client API for user accounts; do not emulate a user with Bot API calls.
- Do not bypass Telegram rate limits or platform security controls.
- Any future remote API must authenticate the calling host, authorize each operation, rate-limit requests, and never proxy account secrets by default.

## Release gate

A release is blocked until session isolation, redaction tests, logout deletion tests, authorization error tests, and real-device login/send/receive checks pass.