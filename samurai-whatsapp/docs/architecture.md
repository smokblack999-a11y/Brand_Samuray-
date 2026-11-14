# Architecture

## Product boundary

SAMURAI WhatsApp Hybrid is a companion app plus a separately governed experimental track. The official WhatsApp app remains independently installed and owns its account, keys, messages, delivery receipts, and media.

## Components

1. **SAMURAI Control Center** — local settings, consent, status, and archive viewer.
2. **Privacy Engine** — local privacy education and controls that Android actually exposes; no false claims of controlling WhatsApp protocol state.
3. **Notification Archive** — Android NotificationListenerService, filtered to WhatsApp package IDs, storing only notification title/body.
4. **Media Vault** — future local encrypted storage for media the user is legitimately able to save or import. No View Once bypass in V1.
5. **Experimental Bridge** — future isolated research branch; no injection, hooking, credential collection, or primary-account use.
6. **Official WhatsApp** — external application; no modification or data-directory access.

## Data flow

`Android notification → package allowlist → visible title/body → AES-GCM encryption → Android Keystore-backed local archive → user-controlled viewer`

No server call is made. No message is sent. No read receipt is changed.

## Security properties

- Android Keystore protects the AES key.
- AES/GCM provides authenticated encryption per record.
- App backup is disabled.
- Archive retention is capped at 200 records.
- User can clear the archive or revoke notification access.
- No permissions for contacts, SMS, accessibility, camera, microphone, VPN, or root.

## Future gates

- Add Room/SQLCipher only if archive scale requires it.
- Add local biometric unlock only after threat-model and recovery design.
- Add a media import flow only for media the user can lawfully and legitimately save.
- Any modified-client experiment requires separate APK identity, test number, malware/dependency review, and explicit risk acceptance. It must never silently replace the official app.
