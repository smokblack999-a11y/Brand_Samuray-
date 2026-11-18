# SAMURAI Messenger — production acceptance contract

Status: implementation work started; NOT production-ready.

This contract prevents demo UI, local echo, or CI compilation from being reported as a functioning messenger.

## Product boundary

SAMURAI Messenger is a first-party messaging service with its own accounts, server, storage and clients. It is not a WhatsApp clone that can override WhatsApp's server-side privacy decisions. The existing Xposed Lab remains a separate optional diagnostics project and must never be a dependency for normal messenger operation.

## Required release gates

A release is not "complete" until every P0 item below has implementation evidence, automated tests, and two-device end-to-end proof.

| ID | Capability | Acceptance evidence | State |
|---|---|---|---|
| P0-01 | Account creation and login | Registration/login, bcrypt password hashing, 15-minute access JWTs, 30-day rotating hashed refresh tokens, logout and revoke-all endpoints; review pending | PARTIAL — API implemented, no Android client or deployed DB |
| P0-02 | Direct conversations | Two independent accounts exchange persisted messages | PARTIAL — REST API and SQL model; no two-device proof |
| P0-03 | Message delivery | Server-accepted, recipient-device-delivered and failed states are distinct | PARTIAL — accepted + receipt endpoint; no Android client / delivery E2E |
| P0-04 | Read receipts | Per-conversation opt-in/out; sender sees read only when recipient permits it | PARTIAL — account-level privacy API and receipt endpoint |
| P0-05 | One-check privacy mode | Suppresses the recipient-delivered acknowledgement sent by this SAMURAI client; UI labels the state honestly and never fabricates network delivery | PARTIAL — server suppresses delivery receipt when recipient setting is off; no client UI |
| P0-06 | Offline queue and sync | Reconnect, duplicate suppression, ordering and retry tests | NOT IMPLEMENTED |
| P0-07 | Attachments | Authenticated upload/download, MIME/size validation, malware scanning strategy, access control | NOT IMPLEMENTED |
| P0-08 | View-once media | Sender opts in; recipient can open once in SAMURAI; expiry and replay denial verified | NOT IMPLEMENTED |
| P0-09 | Delete controls | Delete-for-me and delete-for-everyone with server-enforced policy and audit semantics | NOT IMPLEMENTED |
| P0-10 | Presence / last active | User-controlled visibility; no access to another user's hidden presence | NOT IMPLEMENTED |
| P0-11 | Push notifications | FCM/APNs or supported Android push path, token lifecycle and privacy-safe payloads | NOT IMPLEMENTED |
| P0-12 | Group chats | Membership, roles, fan-out, leave/kick and history policy | NOT IMPLEMENTED |
| P0-13 | Voice/video calls | Signaling, WebRTC media, TURN relay, permission and network tests | NOT IMPLEMENTED |
| P0-14 | Cryptography | Reviewed end-to-end encryption protocol, key verification, rotation, recovery model | NOT IMPLEMENTED — API accepts opaque ciphertext only; no client key protocol |
| P0-15 | Backup / restore | Explicit encrypted export, restore and account recovery tests | NOT IMPLEMENTED |
| P0-16 | Abuse controls | Block/report, spam throttles, account deletion and retention policy | NOT IMPLEMENTED |
| P0-17 | Release engineering | Signed release APK, reproducible CI, SBOM, dependency and secret scan | NOT IMPLEMENTED |

## Required state model

Message state must not be represented by a single mutable checkmark.

- `queued`: accepted locally but not yet acknowledged by server.
- `accepted`: server has durably stored the message.
- `delivered`: at least one recipient device acknowledged receipt, if the recipient's settings allow sending this acknowledgement.
- `read`: recipient explicitly opened the conversation and read receipts are enabled.
- `failed`: send failed; retry is available.

The sender-side UI may display a privacy-preserving neutral state when acknowledgements are suppressed. It must not claim "delivered" or "read" without evidence.

## Security requirements

- No shared global API key embedded in an APK as user authentication.
- Use per-user sessions, short-lived access tokens, refresh-token rotation and revocation.
- Passwords use a modern memory-hard password hash; secrets never enter logs.
- Database access is parameterized and least-privileged.
- Attachments are private by default and authorized on every read.
- Transport uses TLS; E2EE design must be reviewed before any claim that the service is end-to-end encrypted.
- Privacy settings affect only the current user's own signals.
- Xposed hooks remain disabled unless separately tested, documented and explicitly enabled by the device owner.

## Test matrix

Every P0 feature needs:
1. Unit tests for state transitions and authorization.
2. API integration tests against a disposable database.
3. Two-account, two-device end-to-end tests.
4. Offline/reconnect and duplicate-delivery tests where applicable.
5. Negative tests for unauthorized reads, revoked sessions and hidden-presence access.
6. Evidence attached to the release candidate.

## Current known code reality

The screen in `android/samurai-xposed-lab/.../MessengerHomeActivity.kt` explicitly labels itself a local demo and uses in-memory `DemoChat` rows. It is not a network messenger. The main `android/app` launcher on `main` is a camera/gallery/GPS + Telegram client, not the Messenger screen. The Xposed Lab dashboard says hooks are disabled and device verification is not complete.

This is why the project must be implemented as a separate first-party messenger service and Android client rather than relabeling the existing demo.


## Implementation progress — 2026-11-19

Added executable API service under `service/`:
- PostgreSQL-backed account registration/login, bcrypt password hashing, short-lived access JWT, rotating hashed refresh tokens, logout and logout-all.
- Direct conversation creation/listing and authenticated message envelope send/list endpoints with idempotency key.
- Account-level read/delivery/presence privacy settings; recipient's own receipt settings suppress receipt creation.
- Authenticated WebSocket handshake using Authorization header and message-available notifications to conversation members.
- Unit tests for password hashing, validation, access-token signature and refresh-token entropy.
- GitHub Actions workflow starts PostgreSQL 16, applies the schema and runs tests.

Still not a usable release: no Android API client, no E2EE/key exchange, no offline outbox, no media, no push, no group management, no calls, no two-device tests, and no production deployment. The API CI is being validated; do not infer success until its run concludes green.
