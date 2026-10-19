# SamuraiOS unified Android + Core integration

## What this patch changes

- Replaces the app's fused Google Play Services location client with Android framework `LocationManager` fallback (GPS/network providers). Camera and local gallery do not require the Core server to be online.
- Saves capture time and valid latitude/longitude in JPEG EXIF, as well as the existing private JSON sidecar used by the gallery and Telegram photo caption/location.
- Adds a password-gated Termux launcher. The launcher stores only a salted password hash in `$HOME/.config/samuraios/launcher.cred` (mode 0600); no password is placed in the repository.
- Keeps the existing Node Core and X10THINC/agent-control modules; this patch does not claim to implement a personal Telegram MTProto login. Existing Core routes must be configured and tested separately.

## First setup in Termux

```bash
pkg update
pkg install git nodejs-lts openssl curl -y
git clone https://github.com/smokblack999-a11y/Brand_Samuray-.git "$HOME/SamuraiOS"
cd "$HOME/SamuraiOS"
bash termux/samurai.sh
```

If the repository already exists, use `cd "$HOME/SamuraiOS" && git pull --ff-only` only when the working tree is clean and you intend to update it.

The first launch asks you to create a local launcher password. Then choose menu item 1 to install dependencies. Configure `core/.env` locally; do not paste secrets into chat or commit them. Choose item 2 to start Core.

## Android build

GitHub Actions workflow `.github/workflows/android.yml` builds the debug APK. Open Actions in GitHub, run **Build SamuraiOS APK**, and download artifact `SamuraiOS-debug-apk`. This avoids pretending that Termux's 32-bit AAPT2 environment is supported. Direct APK installation still requires Android's install-unknown-apps permission.

## Verification required before release

- Run the Android CI workflow and inspect the result.
- Install the APK on the target device and verify camera permission, GPS disabled/enabled cases, EXIF coordinates/time, gallery selection, and Telegram photo + separate location delivery.
- Run `cd core && npm test` in Termux.
- Personal Telegram account access is not provided by Bot API; use a separately audited MTProto/TDLib module if that is required.
- Android permissions, device location settings, camera hardware and background-execution rules still apply. "Independent of Play Market" does not mean bypassing Android security or hardware requirements.
