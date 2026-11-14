# Threat model

## Protected assets

- WhatsApp notification previews copied to this device
- The archive encryption key
- The user's primary WhatsApp account and existing chat history

## Threats considered

- Accidental disclosure through backups, logs, or network transmission
- Excessive Android permissions
- Archive growth without retention
- Misleading UI that implies protocol-level privacy features work

## Controls in V1

- No network permission or backend integration
- Backup disabled
- Android Keystore AES-GCM encryption
- 200-entry retention cap
- Explicit user-granted notification access
- Only WhatsApp package IDs accepted
- No accessibility, root, VPN, device-admin, SMS, contacts, camera, or microphone permission
- UI explicitly states unavailable protocol-level features

## Residual risks

- Notification access is sensitive: the OS grants access to notifications from apps, even though this service filters WhatsApp at runtime.
- Notification previews may contain private information.
- A compromised or unlocked device may expose content after decryption in the UI.
- Android Keystore protection depends on device security and OS integrity.

## User controls

Revoke Notification Access in Android settings. Clear the archive from the app. Uninstalling the app removes its local data; Keystore key lifecycle follows Android's app/key handling.
