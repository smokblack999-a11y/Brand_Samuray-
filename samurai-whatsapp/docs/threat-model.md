# Threat model

## Protected assets

- WhatsApp notification previews copied to this device
- User-selected media and chat-export transcripts
- Notification, Timeline and Media Vault encryption keys
- The user's primary WhatsApp account and existing chat history

## Threats considered

- Accidental disclosure through backups, logs, screenshots, recents previews or network transmission
- Excessive Android permissions and overbroad visibility into installed apps
- Archive growth without retention
- Misleading UI that implies protocol-level privacy or a persistent VPN kill switch
- Accidental collection after the user no longer wants archiving enabled
- Stale VPN status after Android stops the VPN process

## Controls in the current branch

- No INTERNET permission, backend, analytics or cloud sync
- Android backup disabled
- Android Keystore-backed AES-GCM encryption for notification records, Timeline events, Media Vault files and metadata
- Notification archive cap: 200 records; Timeline cap: 500 events
- Media Vault cap: 100 files, 250 MiB per file, 1 GiB total
- Explicit user-granted Notification Access; listener accepts only WhatsApp package IDs
- User-controlled pause/resume and clear; clear retires the archive key
- SAF grants only for user-selected media/status folders; Status Saver reads only cached accessible media and saves selected files manually
- Chat-export importer accepts user-selected TXT/ZIP files and previews before saving
- App Lock uses Android biometrics/device credential; SAMURAI stores no PIN/password/biometric data; FLAG_SECURE blocks screenshots and app-preview capture while enabled
- VPN permission is requested only after the user activates the network-block control; it routes only WhatsApp package UIDs into a local TUN and discards packets without inspection, persistence or forwarding
- Manifest package visibility is limited to the two WhatsApp package IDs; no QUERY_ALL_PACKAGES
- VPN Always-on support is disabled; a process-state flag prevents stale persisted state from being presented as an active block
- No accessibility, root, device-admin, SMS, contacts, camera or microphone permission

## Residual risks

- Notification access is sensitive: Android grants the listener access to notifications at the OS level, even though this service filters WhatsApp at runtime.
- Notification previews may contain private information.
- A compromised or unlocked device may expose content after decryption in the UI.
- App Lock protection depends on the device's own configured screen lock; it does not protect an already-unlocked or compromised OS.
- SAF providers and Android/WhatsApp versions may expose different cached Status folders; unviewed or hidden statuses are not accessible through this design.
- The VPN block is fail-open, not a system lockdown: if Android stops/revokes the VPN or the service process terminates, WhatsApp may return to its normal network route. Calls, messages and backups stop only while the VPN service is actively routing and dropping packets.
- The VPN service does not provide One Tick, read tracking or presence hiding.
- A Keystore key may become permanently unavailable; affected encrypted entries cannot be decrypted and are skipped rather than reconstructed.
- Notifications may be incomplete, grouped, redacted or suppressed by Android/WhatsApp settings.

## User controls

Revoke Notification Access in Android settings. Pause archiving. Clear the archive, Timeline or Media Vault from the app. Disconnect the selected Status folder to release the SAF permission. Disable App Lock after system authentication. Stop or revoke the VPN from SAMURAI or Android VPN settings. Uninstalling the app removes its local data; Android manages the app's Keystore key lifecycle.
