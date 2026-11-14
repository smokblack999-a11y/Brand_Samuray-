# SAMURAI WhatsApp Hybrid V1

An isolated Android prototype alongside the existing SamuraiOS app. It does **not** replace, patch, clone, or sign in to WhatsApp.

## Current prototype

- Separate Android application ID: `com.samurai.whatsapp`
- Explicit, user-granted Android Notification Listener access
- Captures only visible text notifications from WhatsApp / WhatsApp Business
- Encrypts each saved notification using AES-256-GCM with a key held by Android Keystore
- Local archive capped at 200 entries; no network, analytics, backend, or cloud sync
- Clear-archive action
- Backup disabled

## Honest capability boundary

This prototype is a notification archive, not an unofficial WhatsApp client.

It cannot:
- force a sender to see one grey tick after delivery or reading;
- alter WhatsApp read/delivery receipts;
- guarantee recovery of messages deleted for everyone;
- capture messages whose notification preview is disabled or suppressed;
- save or reopen View Once media;
- hide WhatsApp online, typing, or recording state.

The experimental modified-client track is intentionally not installed, signed, or enabled in this first prototype. It must remain isolated from the primary account until a separate security and account-risk review is approved.

## Build

From the repository root:

```bash
cd android
./gradlew :samurai-whatsapp:assembleDebug
```

APK output:

```
android/samurai-whatsapp/build/outputs/apk/debug/samurai-whatsapp-debug.apk
```

## User setup

1. Install the separately built APK.
2. Open SAMURAI WhatsApp.
3. Read the access explanation and open Android Notification Access settings.
4. Grant access only if you accept that visible WhatsApp notification text is being copied to a local archive.
5. Send a test message to the device and verify the archive.
6. Revoke access from Android settings whenever desired.

Do not grant accessibility, root, VPN, or device-admin access for this prototype.
