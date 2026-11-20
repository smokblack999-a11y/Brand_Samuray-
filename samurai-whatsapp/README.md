# SAMURAI WhatsApp Hybrid V1

An isolated Android companion app alongside the existing SamuraiOS app. It does **not** replace, patch, clone, or sign in to WhatsApp.

## Current implementation in the feature branch

- Separate Android application ID: `com.samurai.whatsapp`
- Explicit, user-granted Android Notification Listener access
- Filters notifications to WhatsApp and WhatsApp Business package IDs
- Reads visible notification text, including AndroidX `MessagingStyle` conversations
- AES-256-GCM encryption for every archived notification record; key stored in Android Keystore
- Local notification archive capped at 200 records, with pause/resume and clear/key retirement
- **Encrypted Media Vault:** import user-selected images, videos and audio via Android's system document picker; AES-GCM/Android Keystore; encrypted metadata; app-private files; export, delete, clear
- Media Vault guardrails: 100 items, 250 MiB per file and 1 GiB total; import/export on background threads; no broad storage permission
- **Official chat-export importer:** import the user's own WhatsApp `.txt` or `.zip` chat export; inspect a preview and message count before saving; duplicate-safe re-import based on source hash; encrypted conversation archive; list, read and delete imported chats
- Export-import guardrails: compressed/input source up to 20 MiB, normalized transcript up to 24 MiB, 20,000 messages per export, 100 imported conversations
- ZIP import currently reads the chat TXT entry only. Media attachments bundled in the ZIP are not extracted automatically; they can be added separately through the user-selected Media Vault.
- Instrumentation tests cover Media Vault encryption/round-trip/delete/re-key and chat export parsing, ZIP TXT extraction, locale-aware timestamp parsing, deduplication and encrypted restore (CI pending)
- No INTERNET permission, analytics, backend or cloud sync; app backup disabled

## Honest capability boundary

This is a companion app, not an unofficial WhatsApp client.

It cannot:
- force a sender to see one grey tick after delivery or reading;
- alter WhatsApp delivery/read receipts;
- guarantee recovery of messages deleted for everyone;
- capture content when notification previews are disabled, suppressed, or not posted;
- save or reopen View Once media;
- hide WhatsApp online, typing, or recording state;
- read another user's hidden last-seen/read state.

Anti-Delete is partial: a notification copy may remain in SAMURAI after a later deletion, but only if Android delivered the message text in a notification first.

Media Vault imports files the user selects through Android's document picker. It does not bypass View Once or scrape another application's private media directory.

The chat-export importer reads files that the user explicitly exports from WhatsApp. It does not inspect WhatsApp's private database or infer the user's identity in a group transcript; participant names are retained as present in the export.

The experimental modified-client track is not installed, signed, or enabled. It must remain isolated from the primary account until a separate security and account-risk review is approved.

## Research and planned tracks

See [competitive research and build plan](docs/research-and-build-plan.md) for the reviewed public projects, feature feasibility, licensing notes, One Tick lab acceptance tests, Read Intelligence provenance rules, and phased build order.

- **Safe companion:** complete emulator CI and validate notification archive, Media Vault, chat-export import, Status Saver and local security controls on a physical device.
- **Status Saver:** implemented as a manual SAF-based browser for cached status media already user-accessible after viewing; Galaxy A54 path/permission validation remains.
- **Read Intelligence:** record only verifiable events with source provenance. Missing read/presence events remain unknown.
- **Official Business mode:** optionally receive Meta Business Platform status webhooks for messages sent through that API. This does not track a personal WhatsApp account.
- **One Tick lab:** separate research build only, requiring a dedicated test number, spare rooted device and second-device validation. Do not root or modify the primary phone.

## Build and test

From the repository root:

```bash
cd android
./gradlew :samurai-whatsapp:assembleDebug
./gradlew :samurai-whatsapp:connectedDebugAndroidTest
```

APK output:

```
android/samurai-whatsapp/build/outputs/apk/debug/samurai-whatsapp-debug.apk
```

GitHub Actions builds both SAMURAI Android apps, checks required Kotlin classes in DEX, runs notification archive, Media Vault and export-import tests on an Android emulator, and uploads APKs only if all checks pass.

## Install and setup on Samsung

1. Download the **SAMURAI WhatsApp** APK artifact from a successful GitHub Actions run.
2. Install it as a separate app. Do not uninstall or replace official WhatsApp.
3. Open SAMURAI WhatsApp and read the notification-access explanation.
4. Grant Notification Access only if you accept that visible WhatsApp notification text will be copied to a local archive.
5. Ensure WhatsApp notifications and message previews are enabled for the conversations you want archived.
6. Send a test text message to the phone and check that it appears in the local archive.
7. Test the pause switch and clear operation.
8. Import a user-selected media file, export it to a different folder, and compare the exported file with the original.
9. In WhatsApp, export a test chat as `.txt` or `.zip`; import it into SAMURAI, inspect the preview, then verify the saved message count and transcript.
10. Test individual deletion and Clear Media Vault / Clear Imported Chats.
11. Revoke Notification Access in Android settings whenever desired.

Do not grant accessibility, root, VPN, device-admin, contacts, SMS, camera, or microphone access for this prototype.

## Release status

Code and automated tests have been added to the feature branch. They are **not CI-verified until the latest GitHub Actions run completes successfully**. CI and emulator results do not replace a real Samsung device test. The app must be installed and manually checked on the target Galaxy A54 before it can be called device-validated.


## V1.5 local security and intelligence modules

- **Status Saver:** uses Android Storage Access Framework to inspect only a user-selected WhatsApp/Media or .Statuses tree. It lists up to 300 already-cached image/video files and manually copies a selected file into Media Vault. It does not access unviewed/hidden statuses, View Once media or another app's private database.
- **Message Timeline:** encrypted local ledger capped at 500 entries. Current event producers are incoming notification capture and user-imported chat export only. Source event time and local observation time remain separate; read/delivery/presence signals are not invented.
- **App Lock:** Android biometric/device-credential prompt at launch and after 30 seconds in background. SAMURAI stores only the enabled flag, never a PIN, password or biometric template. FLAG_SECURE blocks screenshots and app-preview capture while enabled.
- **Per-app network block:** explicit Android VPN consent; only WhatsApp/WhatsApp Business package UIDs are routed to a local TUN and packets are discarded, not inspected or forwarded. It is session-bound and fail-open if the service stops; it is not Android Always-on/Lockdown.
- **Package visibility:** manifest queries only com.whatsapp and com.whatsapp.w4b; no broad QUERY_ALL_PACKAGES permission.

The latest emulator attempt built both apps and passed DEX verification, but instrumentation crashed before any test completed (0/0). APK upload was skipped. No Galaxy A54 physical-device validation is claimed.

## Message-status evidence model (added 2026-11-17)

The Android companion now includes `MessageStatusReducer` and instrumentation coverage for verified status evidence. It models server acceptance, device delivery, confirmed read, and media-played states only when an approved source supplies the event. Unsupported sources and invalid timestamps are ignored; an empty event set remains `UNKNOWN`.

This is a reusable foundation for a SAMURAI-owned messenger and official WhatsApp Business Platform webhooks. It is **not connected to personal WhatsApp outgoing messages**, does not alter WhatsApp ticks, and cannot reveal read receipts or presence hidden by another person's privacy settings.
