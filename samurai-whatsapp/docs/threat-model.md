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
- Accidental collection after the user no longer wants archiving enabled

## Controls in V1

- No network permission or backend integration
- Backup disabled
- Android Keystore AES-GCM encryption per record
- 200-entry retention cap
- Explicit user-granted notification access
- Only WhatsApp package IDs accepted
- User-controlled pause/resume switch
- User-confirmed clear-archive action that also deletes the archive's Keystore key (cryptographic retirement)
- No accessibility, root, VPN, device-admin, SMS, contacts, camera, or microphone permission
- UI explicitly states unavailable protocol-level features

## Residual risks

- Notification access is sensitive: Android grants the listener access to notifications at the OS level, even though this service filters WhatsApp at runtime.
- Notification previews may contain private information.
- A compromised or unlocked device may expose content after decryption in the UI.
- Android Keystore protection depends on device security and OS integrity.
- If the Keystore key becomes permanently unavailable, previously encrypted entries cannot be decrypted; the app currently skips unreadable entries rather than recovering plaintext.
- Notifications may be incomplete, grouped, redacted, or suppressed by Android/WhatsApp settings.

## User controls

Revoke Notification Access in Android settings. Pause archiving in the app. Clear the archive from the app. Uninstalling the app removes its local data; Android manages the app's Keystore key lifecycle.
