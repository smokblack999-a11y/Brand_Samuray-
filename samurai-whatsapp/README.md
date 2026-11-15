# SAMURAI WhatsApp Hybrid V1

An isolated Android companion app alongside the existing SamuraiOS app. It does **not** replace, patch, clone, or sign in to WhatsApp.

## Current implementation in the feature branch

- Separate Android application ID: `com.samurai.whatsapp`
- Explicit, user-granted Android Notification Listener access
- Filters notifications to WhatsApp and WhatsApp Business package IDs
- Reads visible notification text, including AndroidX `MessagingStyle` conversations
- AES-256-GCM encryption for every archived notification record; key stored in Android Keystore
- Local notification archive capped at 200 records
- User can pause/resume archiving and clear the archive; clearing also retires the old Keystore key
- **Encrypted Media Vault:** import images, videos and audio through Android's system document picker; store files and index metadata encrypted in app-private storage using AES-GCM and Android Keystore; export, delete individual items or clear the vault
- Media Vault guardrails: up to 100 items, 250 MiB per item, no broad storage permission, no network permission, no server upload
- Instrumentation tests cover Media Vault encrypted round-trip, plaintext absence, unsupported MIME rejection, delete and clear/re-key behavior (CI pending)
- App backup disabled

## Honest capability boundary

This is a companion app, not an unofficial WhatsApp client.

It cannot:
- force a sender to see one grey tick after delivery or reading;
- alter WhatsApp delivery/read receipts;
- guarantee recovery of messages deleted for everyone;
- capture content when notification previews are disabled, suppressed, or not posted;
- save or reopen View Once media;
- hide WhatsApp online, typing, or recording state.

Anti-Delete is partial: a notification copy may remain in SAMURAI after a later deletion, but only if Android delivered the message text in a notification first.

Media Vault imports files the user selects through the Android document picker. It does not bypass View Once or scrape another application's private media directory.

The experimental modified-client track is not installed, signed, or enabled. It must remain isolated from the primary account until a separate security and account-risk review is approved.

## Research and planned tracks

See [competitive research and build plan](docs/research-and-build-plan.md) for the public projects reviewed, feature feasibility, license notes, One Tick lab acceptance tests, Message Timeline model, and phased build order.

- **Safe companion:** complete CI and validate notification archive and Media Vault on the Galaxy A54.
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

GitHub Actions builds both SAMURAI Android apps, checks required Kotlin classes in DEX, runs archive and Media Vault tests on an Android emulator, and uploads APKs only if all checks pass.

## Install and setup on Samsung

1. Download the **SAMURAI WhatsApp** APK artifact from a successful GitHub Actions run.
2. Install it as a separate app. Do not uninstall or replace official WhatsApp.
3. Open SAMURAI WhatsApp and read the notification-access explanation.
4. Grant Notification Access only if you accept that visible WhatsApp notification text will be copied to a local archive.
5. Ensure WhatsApp notifications and message previews are enabled for the conversations you want archived.
6. Send a test text message to the phone and check that it appears in the local archive.
7. Test the pause switch: send another message while paused and confirm the archive count does not increase.
8. Import a user-selected media file, export it to a different folder, and compare the exported file with the original.
9. Test deletion and Clear Media Vault. Re-import a test file to confirm the new Keystore key is usable.
10. Revoke Notification Access in Android settings whenever desired.

Do not grant accessibility, root, VPN, device-admin, contacts, SMS, camera, or microphone access for this prototype.

## Release status

Code and automated tests have been added to the feature branch. They are **not CI-verified until the latest GitHub Actions run completes successfully**. CI and emulator results do not replace a real Samsung device test. The app must be installed and manually checked on the target Galaxy A54 before it can be called device-validated.
