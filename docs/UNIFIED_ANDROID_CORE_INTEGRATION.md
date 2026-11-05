# Unified SamuraiOS integration plan and acceptance gate

## Target

One repository and one Android APK combining the existing SamuraiOS camera/gallery UI, Telegram/Core APIs and X10THINC control plane. Core is optional for local photo capture and gallery browsing; network features fail visibly when Core is unavailable.

## Current implementation in this branch

- GeoCam uses Android framework `LocationManager` instead of requiring Google Play Services Location.
- JPEG capture time and valid coordinates are written to EXIF; the app's JSON sidecar remains the gallery/Core source for accuracy and Telegram caption.
- `termux/samurai.sh` adds a local password gate and menu for Core dependencies, start/stop/status/tests/logs/diagnostics and optional APK build.
- No credentials are embedded in source. The launcher credential is a salted SHA-512-crypt hash in the user's Termux config directory.

## Known limitations (do not claim otherwise)

- The current Android screen is a basic single-activity interface, not a production polished multi-screen app.
- The current gallery stores private copies under app filesDir, not automatically in the public Android Photos/Gallery provider.
- Camera capture is saved even if GPS cannot obtain a fix; no coordinates are fabricated.
- The app currently uses Core routes for Telegram operations. This does not prove personal-account login is configured or that every route is available.
- No Android device run, APK installation, or CI result has been performed by this patch authoring step.

## Release acceptance checklist

1. Android workflow builds APK on GitHub Actions.
2. Install APK directly on the target Android device.
3. Test camera with location permission allowed, denied, and location services disabled.
4. Inspect JPEG EXIF using an independent EXIF reader and compare with sidecar JSON.
5. Test gallery selection and Telegram send-photo on a controlled test chat.
6. Confirm Core health and error behavior with invalid/missing API keys.
7. Run Core tests; Kill Critic must block release if any mandatory check fails.
8. Confirm no API keys, Telegram tokens, launcher passwords or session files are committed.
