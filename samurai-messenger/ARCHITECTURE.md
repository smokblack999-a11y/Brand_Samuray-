# SAMURAI Messenger architecture

## Components

1. Android client — account/session UI, conversation list, message timeline, media picker, local encrypted cache, offline outbox, push-token registration.
2. API service — authentication, conversation membership, message persistence, receipts, presence policy, attachment authorization, abuse controls.
3. PostgreSQL — durable accounts, devices, sessions, conversations, memberships, messages, receipt events, attachment metadata and device push tokens.
4. Object storage — private encrypted media objects with short-lived authorized download URLs.
5. Realtime delivery — authenticated WebSocket connection; reconnect cursor and server-side replay.
6. Push — notification wake-up only; do not place plaintext message bodies in push payloads by default.
7. Optional Xposed Lab — isolated diagnostics only. It is not part of the messenger's trust boundary.

## Message lifecycle

Client creates a UUID idempotency key and stores an encrypted local outbox record. API authenticates the sender, checks membership and rate limits, then commits the message and idempotency key in one database transaction. Realtime fan-out notifies recipient devices. Recipient acknowledgement is recorded separately from server acceptance. Read acknowledgement is a distinct event controlled by the recipient's own privacy settings.

The sender UI must never infer recipient delivery/read from a successful HTTP response.

## Privacy semantics

- Hide own read receipts: do not emit read events for this user's account.
- Hide own delivery acknowledgements: do not emit recipient-device delivery events for this user's account; sender sees an honest neutral/unknown state.
- One-check appearance: a presentation choice is not delivery evidence and must not be used to mislead another participant.
- View-once: implement only inside SAMURAI, with one-time server authorization and local expiry. It cannot prevent screenshots, external cameras or OS-level capture on every device.
- Delete for everyone: server-mediated deletion within a declared policy window; recipients may already have exported or captured content.
- Last active: show only according to the account owner's visibility policy.

## Non-goals

- Reading another person's hidden online/last-seen state.
- Bypassing another person's read receipts.
- Defeating view-once or delete-for-everyone controls in third-party messengers.
- Claiming absolute screenshot prevention or anti-ban guarantees.

## Deployment prerequisites

A real public release requires an owned HTTPS domain, managed PostgreSQL, private object storage, push credentials, monitoring, backups, data-retention policy, signed Android release key and a privacy/security review. These are not assumed to exist or configured by this repository change.
