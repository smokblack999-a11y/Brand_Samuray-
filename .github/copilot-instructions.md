# SamuraiOS repository instructions

## Android build contract

- The Android project lives in `android/`.
- Use the committed Gradle wrapper; do not replace it with a system Gradle installation.
- The project uses Android Gradle Plugin 8.7.3, Kotlin 2.0.21, Gradle 8.9, compileSdk/targetSdk 35, and Java 17 for CI.
- AndroidX is required. Keep `android.useAndroidX=true` enabled.
- Prefer GitHub Actions on `ubuntu-latest` for Android builds. Do not treat a 32-bit Termux/Android userspace as the CI build target.
- Primary verification command: `cd android && ./gradlew :app:clean :app:assembleDebug --stacktrace --no-daemon`.
- Expected debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Agent workflow

1. Inspect the repository and current CI before changing code.
2. Reproduce the reported failure when possible and identify the root cause from the actual error, not from guesses.
3. Make the smallest correct change that fixes the root cause.
4. Preserve tests, secret scanning, AndroidX, and CI validation. Never disable checks just to obtain a green build.
5. Re-run the relevant validation after every fix.
6. Never commit API keys, `.env` files, local SDK paths, Gradle caches, build outputs, or credentials.
7. Work on a dedicated branch and open a pull request against `main`; do not modify `main` directly for debugging work.
8. In the final report, state the root cause, changed files, validation commands/results, and the APK artifact path.
