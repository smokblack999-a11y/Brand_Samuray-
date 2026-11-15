# Architecture

## Product boundary

SAMURAI WhatsApp Hybrid is a standalone Android companion app. The official WhatsApp app remains independently installed and owns its account, keys, private database, delivery receipts and media. The companion uses Android interfaces and files the user explicitly selects.

## Components

1. **SAMURAI Control Center** — local settings, consent, capability status and archive viewers.
2. **Notification Archive** — opt-in NotificationListenerService, filtered to WhatsApp and WhatsApp Business package IDs; stores only visible notification content.
3. **Media Vault** — AES-GCM encrypted app-private storage for images, videos and audio explicitly imported through Android's document picker; supports export, delete and clear.
4. **Official Chat Export Importer** — parses user-selected WhatsApp TXT/ZIP exports, previews messages, deduplicates by source hash and stores the transcript encrypted. ZIP media entries are not extracted.
5. **Status Saver** — browses up to 300 image/video files from a user-selected SAF tree containing .Statuses; manually copies a selected item into Media Vault. Only already-cached and accessible files are visible.
6. **Message Timeline** — encrypted local ledger with source and time provenance. Current producers are notification capture and user-imported chat exports only; no read/presence/acknowledgement adapter is active.
7. **App Lock** — Android biometric/device-credential prompt; the app stores only an enabled flag. While enabled, FLAG_SECURE prevents screenshots and app-preview capture.
8. **Per-app Network Block** — explicitly user-consented VpnService allows only installed WhatsApp package UIDs into a local TUN route and discards packets. It does not inspect, store or forward payloads. It is session-bound, not Always-on/Lockdown, and fails open if the service stops.
9. **Experimental Bridge** — future isolated research build; no injection, hooking, credential collection or primary-account use.
10. **Official WhatsApp** — external application; no modification or private data-directory access.

## Data flows

- Android notification → package filter → visible title/body → AES-GCM encryption → Android Keystore-backed archive
- User-selected image/video/audio → document picker → Media Vault AES-GCM file + encrypted metadata
- User-selected WhatsApp TXT/ZIP export → parser → preview → source-hash dedupe → encrypted chat archive
- User-selected SAF tree → cached .Statuses metadata → manual save → Media Vault
- Notification capture / export import → provenance-aware event → encrypted Message Timeline
- User consent → Android VPN preparation → app-filtered TUN → packet discard → foreground status notification

No server call is made, no message is sent, and no read receipt or WhatsApp protocol state is changed.

## Security properties and constraints

- Android Keystore protects archive, Timeline and Media Vault encryption keys.
- App backup is disabled; the companion has no INTERNET permission or analytics/backend sync.
- Retention/size limits: notification archive 200 records; Timeline 500 events; Media Vault 100 files, 250 MiB/file, 1 GiB total; Status Saver lists at most 300 items.
- Notification access, SAF folder access, biometric/device credential and VPN use are separately user-controlled.
- Package visibility is restricted to com.whatsapp and com.whatsapp.w4b; no QUERY_ALL_PACKAGES.
- The VPN is not a persistent fail-closed kill switch. On service termination the regular WhatsApp network route may resume.
- Missing read, delivery or presence signals remain unknown; the companion does not bypass privacy settings or View Once.

## Future gates

- Add official Meta Business Platform status webhooks only for messages sent through that API, with signature validation and retry deduplication.
- Any modified-client experiment requires separate APK identity, a dedicated test number/device, malware/dependency review, exact version gate and explicit risk acceptance. It must never silently replace or modify the primary WhatsApp installation.
