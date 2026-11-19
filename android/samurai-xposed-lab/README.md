# SAMURAI Xposed Lab + Messenger

Separate Android application/module. The Xposed lab and the local messenger UI are independent of the official WhatsApp application.

## Messenger features in build 0.2.0

- Persistent local chats and messages using the private app SQLite database.
- Demo conversations are seeded only on a fresh database install.
- Create personal or group local conversations.
- Search across conversation titles, previews and local message text.
- Filters: all, unread, personal, groups.
- Mark a conversation read when it is opened.
- Pin/unpin conversations.
- Send and delete your own local demo messages.
- Bottom navigation for chats, contacts, calls and profile/settings.
- Shared appearance preferences across the dashboard and messenger: system/light/dark theme, four accent colors, text size 85–125%, compact layout.
- All conversation data remains on this device in this version.
- Export and restore through Android's system file picker using a versioned JSON backup; import is size-limited and skips exact duplicates.
- Custom SAMURAI X10 adaptive launcher icon and shared theme settings.

**Important:** This is a local-first UI prototype, not a network messenger and not a WhatsApp clone. Messages are stored only on this device and are not delivered to WhatsApp, contacts or another SAMURAI installation. Calls, remote contacts, account login, synchronization, E2E transport, push notifications, media transfer and group membership are not implemented yet. The UI says local-only to prevent confusion. JSON exports are not encrypted; protect the exported file yourself.

## Xposed lab scope

- Legacy Xposed API 82, compile-only.
- Exact package scope: `com.whatsapp` and `com.whatsapp.w4b`.
- Main-process and exact-version compatibility gate.
- Non-mutating host diagnostics after `Application.attach`: package/process/version only.
- No chat, contact, notification, media, credential or message-body capture.
- No receipt, presence, View Once or Anti-Revoke hooks are enabled.

## Requirements

- The standalone dashboard/messenger starts on Android without root.
- Loading the Xposed entry point inside WhatsApp requires a compatible rooted device and Xposed/LSPosed runtime.
- Device-level module activation has not been accepted on Samsung Galaxy A54.
- Use a spare test device/account for any future host-app compatibility work.

## Build

From repository root:

```bash
cd android
./gradlew :samurai-xposed-lab:testDebugUnitTest :samurai-xposed-lab:assembleDebug
```

Output:

`android/samurai-xposed-lab/build/outputs/apk/debug/samurai-xposed-lab-debug.apk`

## Quality gates

CI runs JVM tests for compatibility checks and messenger filtering, builds the APK, validates Xposed metadata, and confirms the messenger classes are packaged. Passing CI does not prove real-device UI behavior or network delivery.
