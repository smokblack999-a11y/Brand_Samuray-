# SamuraiOS Android: build, connect and verify

## What the APK does

The Android app provides CameraX capture, app-private photo storage, import from the device's image picker, GPS metadata when Android supplies a location fix, and a Telegram user-session interface backed by SamuraiOS Core.

The Android app does **not** contain a Telegram login session. The logged-in Telegram account and its session stay on the Core server.

## Get the debug APK

1. Open the [latest Android build workflow](https://github.com/smokblack999-a11y/Brand_Samuray-/actions/workflows/android.yml).
2. Open a successful run for the branch/commit you intend to test.
3. Under **Artifacts**, download `SamuraiOS-debug-apk`.
4. Extract the ZIP and install `app-debug.apk` on Android 8.0 (API 26) or newer.

This is a debug-signed APK for private testing, not a signed production release. The default Core URL is intentionally `https://core.example.invalid`; configure your real endpoint in the app before testing Telegram.

## Configure SamuraiOS Core

Run Core behind a real HTTPS reverse proxy or HTTPS hosting service. The app refuses to save an HTTP endpoint because its API key is sent to the Core server.

On the server, from the repository's `core/` directory:

```sh
npm ci
cp .env.example .env
```

Set the environment values using your server's secret manager (or the server-only `.env` file, which must never be committed):

- `CORE_API_KEY`: long, randomly generated API key, at least 16 characters.
- `TELEGRAM_WEBHOOK_SECRET`: random secret for Telegram Business webhook validation.
- `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`: API credentials from Telegram's developer portal.
- `TELEGRAM_SESSION`: authenticated GramJS `StringSession` for the Telegram user account.
- `PORT=8787` unless your hosting platform sets `PORT`.
- `NODE_ENV=production` in production.

To create the user session locally, set `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in the local server-only `.env`, then run:

```sh
node telegram-login.js
```

The login script writes `TELEGRAM_SESSION` into Core's local `.env`. Transfer it to the deployed server through the secret manager. Never paste the session in this repository, into the Android app, or into screenshots/support messages. Treat this session like the Telegram account password; rotate/revoke it if exposed.

Deploy/restart Core, then check `https://YOUR-CORE-DOMAIN/health`. A healthy `/health` response confirms only that the HTTP service is responding; Telegram authentication still needs separate verification.

## Configure the Android app

1. Install and open SamuraiOS.
2. In **ПОДКЛЮЧЕНИЕ CORE • HTTPS**, enter the real Core URL, for example `https://core.your-domain.example`.
3. Enter the Core API key and tap **СОХРАНИТЬ CORE НАСТРОЙКИ**.
4. Check for **Core: ONLINE**. This only proves `/health` responds; it does not prove Telegram is authenticated.
5. Tap **Мой Telegram**, then **Диалоги**. Choose a valid chat ID and test text/photo sending.

The app stores the API key encrypted with an AES key held in Android Keystore. The server URL is stored in private app preferences. The API key is not compiled into the APK, but it remains a powerful credential on the device: use a dedicated private-MVP key and rotate it if the device is lost. Local encryption is not a substitute for per-user authentication, revocation, or server-side authorization.

## Verify the important flows

- Grant Camera permission; deny Location permission and confirm the camera still opens.
- Take a photo. It should appear in the private SamuraiOS gallery.
- Grant location permission and enable device location to test GPS capture. A GPS fix is not guaranteed indoors or when location services are unavailable.
- Import a PNG/WebP/JPEG image; its extension should be preserved in private storage.
- Choose a Telegram chat and send text.
- Send a photo with valid GPS. The photo caption includes the coordinates; Core also attempts to send a native Telegram location as a separate message.
- Test a photo over 10 MiB; the app should reject it before upload.
- Restart the app and confirm the Core URL remains saved and the API key still authenticates.

A successful GitHub Actions run proves build/tests for that commit, not physical-device end-to-end behaviour. Record the APK artifact's commit SHA when reporting a test result.
