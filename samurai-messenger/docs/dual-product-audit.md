# SAMURAI Dual Messenger — Code Audit and Implementation Plan

## Repository snapshot

Audit source: PR #141, branch `feat/samurai-whatsapp-hybrid-v1`, head `e15082634ef3c3d88d4e9158bcc36742650aee6b`.

### WhatsApp Hybrid — found in source

- `com.samurai.whatsapp` Android companion application.
- Opt-in NotificationListenerService filtered for WhatsApp package notifications.
- Android Keystore-backed AES-GCM encrypted local archive.
- Encrypted Media Vault with user-selected import/export.
- User-selected chat export importer and encrypted archive.
- SAF-based cached status saver.
- App Lock/biometric and screenshot protection.
- Encrypted event Timeline with explicit event-source provenance.
- Optional local VPN network block service.
- Narrow package visibility for WhatsApp and WhatsApp Business.

### Known gaps / not supported

- No protocol-level one-tick suppression in the official WhatsApp client.
- No private read-receipt or hidden-presence extraction.
- No guaranteed Last Seen/Online for contacts who hide it.
- No View Once bypass or protected-media recovery.
- No complete theme/font engine.
- No SAMURAI Messenger transport, account system, server, peer discovery, push, or multi-device sync yet.
- Current source README says emulator instrumentation and physical-device validation remain pending; earlier CI claims of complete tests must not be repeated without fresh check evidence.

## SAMURAI Messenger — foundation

A transport-independent message domain model was added in `android/app/src/main/java/com/samuraios/app/messenger/MessageCore.kt`.

It establishes:
- Explicit delivery states, including UNKNOWN.
- Receipt-visibility UI policy (not protocol interception).
- Disappearing-message TTL options.
- Expiration calculation and checks.
- Validation against negative timestamps and inconsistent READ state.

This is wired to a prototype single-file encrypted local store (`MessageStore.kt`) using AES-GCM with an Android Keystore key. It is still not wired to UI, network transport, E2E encryption, registration, push, or message delivery. The store is an early prototype; transactional database, migrations, concurrency, atomic replacement robustness, key rotation, backup policy review, and tests remain required.

## Next implementation sequence

1. Replace the prototype encrypted file store with transactional Room/SQLite storage and migrations; keep payload encryption with Keystore-managed keys.
2. Implement conversation/contact schema and migrations.
3. Implement message composer + conversation list UI.
4. Build transport contract and testable local loopback/demo transport.
5. Design server transport: HTTPS API, authenticated device registration, WebSocket delivery, idempotent message IDs, rate limits.
6. Implement end-to-end encryption using audited protocol/library rather than inventing cryptography; key rotation, identity verification, recovery and multi-device design.
7. Add push notifications with minimal payload; never include plaintext message content in push.
8. Implement receipts and presence as explicit opt-in peer-sharing; hide settings respected. UNKNOWN is displayed when no signal exists.
9. Implement disappearing messages as best-effort client-side deletion, with clear warning that recipients may save/capture content.
10. Separate WhatsApp companion from Messenger identities, packages, databases, keys, permissions and backend services.

## Product acceptance gates

- Local encrypted database round-trip and tamper tests pass.
- E2E encryption protocol review and independent threat review.
- Two-device test: registration, send, delivery, read, offline queue, reconnect, duplicate/out-of-order events.
- TTL test across app restart, device offline, clock changes and notification previews.
- Account recovery tested without plaintext key escrow.
- No UI may claim message read/delivered/presence when state is UNKNOWN.
- No WhatsApp account modifications in this Messenger branch.
