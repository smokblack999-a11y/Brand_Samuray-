# SAMURAI Xposed Compatibility Lab

This is a separate Android application/module from the regular SAMURAI WhatsApp companion.

## Current build scope

- Xposed legacy API 82, compile-only.
- Exact package scope: `com.whatsapp` and `com.whatsapp.w4b`.
- Main-process and exact-version compatibility gate.
- Non-mutating startup diagnostics: package name, process name, version name and version code.
- No chat, contact, notification, media, credential or message-body capture.
- No receipt, presence, view-once or anti-revoke hooks are installed in this initial lab build.
- Feature activation is hard-disabled in code until each feature has a separate review, exact version mapping and device acceptance.

## Requirements

- Android device with an Xposed-compatible runtime such as LSPosed.
- Root is required by typical LSPosed deployments. Availability and compatibility depend on the device/ROM.
- Use a spare test device and dedicated test account only. Never activate experimental hooks against a primary WhatsApp account.

## Build

From the repository root:

```bash
cd android
./gradlew :samurai-xposed-lab:testDebugUnitTest :samurai-xposed-lab:assembleDebug
```

The debug APK is written to:

`android/samurai-xposed-lab/build/outputs/apk/debug/samurai-xposed-lab-debug.apk`

## Promotion gate for any future feature

A host version must be identified from an authorized local APK, the exact package/version tuple must be added to a reviewed compatibility record, and the feature must pass unit tests plus two-device tests on dedicated test accounts. A successful Xposed load event is not proof that a hook works.

This lab intentionally starts with diagnostics only. It is not an unofficial WhatsApp client and does not promise anti-ban behavior.
