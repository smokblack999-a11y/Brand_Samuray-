# SAMURAI WhatsApp Hybrid V1

An isolated Android companion app alongside the existing SamuraiOS app. It does **not** replace, patch, clone, or sign in to WhatsApp.

## Current implementation

- Separate Android application ID: `com.samurai.whatsapp`
- Explicit, user-granted Android Notification Listener access
- Filters notifications to WhatsApp and WhatsApp Business package IDs
- Reads visible notification text, including AndroidX `MessagingStyle` conversations
- AES-256-GCM encryption for every archived record; key stored in Android Keystore
- Local archive capped at 200 records
- User can pause/resume archiving and clear the archive
- No network permission, analytics, backend, or cloud sync
- App backup disabled
- CI verifies the APK contains the three required Kotlin classes
- Android emulator tests cover encryption round-trip, plaintext absence, pause behavior, and retention cap

## Honest capability boundary

This is a notification archive, not an unofficial WhatsApp client.

It cannot:
- force a sender to see one grey tick after delivery or reading;
- alter WhatsApp delivery/read receipts;
- guarantee recovery of messages deleted for everyone;
- capture content when notification previews are disabled, suppressed, or not posted;
- save or reopen View Once media;
- hide WhatsApp online, typing, or recording state.

Anti-Delete is therefore partial: a notification copy may remain in SAMURAI after a later deletion, but only if Android delivered the message text in a notification first.

The experimental modified-client track is not installed, signed, or enabled. It must remain isolated from the primary account until a separate security and account-risk review is approved.

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

GitHub Actions builds both SAMURAI Android apps, checks that required Kotlin classes are packaged in DEX, runs archive tests on an Android emulator, and uploads APKs only if all checks pass.

## Install and setup on Samsung

1. Download the **SAMURAI WhatsApp** APK artifact from a successful GitHub Actions run.
2. Install it as a separate app. Do not uninstall or replace official WhatsApp.
3. Open SAMURAI WhatsApp and read the notification-access explanation.
4. Grant Notification Access only if you accept that visible WhatsApp notification text will be copied to a local archive.
5. Ensure WhatsApp notifications and message previews are enabled for the conversations you want archived.
6. Send a test text message to the phone and check that it appears in the local archive.
7. Test the pause switch: send another message while paused and confirm the archive count does not increase.
8. Test Clear Archive and confirm the archive is empty.
9. Revoke Notification Access in Android settings whenever desired.

Do not grant accessibility, root, VPN, device-admin, contacts, SMS, camera, or microphone access for this prototype.

## Release status

A successful CI build and emulator test do not replace a real Samsung device test. The app must be installed and manually checked on the target Galaxy A54 before it can be called device-validated.
