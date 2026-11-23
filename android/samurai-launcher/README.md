# SAMURAI Launcher X1

Independent Android HOME module for the SAMURAI OS repository.

## Included in this initial implementation

- Android HOME + DEFAULT intent filters
- Launcher activity discovery using a narrow package-visibility query
- Local app-name search and app launching
- Crimson/black Command Center
- Explicit capability labels; no fabricated Core or security status

## Not implemented yet

- SAMURAI Core API connection
- Real Ghost Shield permission controls
- In-launcher WhatsApp or Telegram messaging
- Widgets, gestures, favorites, folders, notification access, AI requests
- Backup/restore and telemetry controls beyond the current no-network design

## Build

From the `android` directory:

```bash
./gradlew :samurai-launcher:assembleDebug
```

The APK is a debug build, not a production-signed release. Install it and select SAMURAI Launcher through Android's Home app settings. The app does not silently replace the current launcher.

## Privacy and permissions

The initial module declares no runtime permissions and makes no network requests. Its package visibility is limited to activities exposing the MAIN/LAUNCHER intent.
