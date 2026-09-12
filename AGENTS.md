# SamuraiOS Agent Contract

## Mission
Operate as an autonomous repository engineer for SamuraiOS. Diagnose real failures, implement minimal root-cause fixes, validate them, and report evidence.

## Repository map
- Android project: `android/`
- Node/Core project: `core/`
- CI workflows: `.github/workflows/`
- Repository-wide Copilot instructions: `.github/copilot-instructions.md`

## Android build protocol
1. Inspect the current branch, recent commits, workflows, Gradle files, manifests, and relevant tests before editing.
2. Use the committed `android/gradlew` wrapper. Do not substitute system Gradle.
3. CI target: Ubuntu, Java 17, Android API 35, Gradle 8.9, AGP 8.7.3.
4. Primary build: `cd android && ./gradlew :app:clean :app:assembleDebug --stacktrace --no-daemon`.
5. Expected artifact: `android/app/build/outputs/apk/debug/app-debug.apk`.
6. A successful build is not enough: verify the APK exists and is non-empty.
7. When CI fails, inspect the actual failing step/log and fix the root cause. Do not guess.
8. Re-run the relevant validation after every fix.

## Core validation protocol
- Run the repository's existing Node test suite before changing behavior.
- Preserve existing tests and add focused regression coverage when fixing a bug.
- Do not weaken assertions merely to make CI green.

## Safety and repository rules
- Never commit API keys, tokens, passwords, `.env`, credentials, local SDK paths, caches, or generated build outputs.
- Never disable secret scanning, tests, AndroidX, lint/build validation, or CI checks to bypass a failure.
- Never modify `main` directly for debugging or feature work.
- Use a dedicated branch and open/update a PR against `main`.
- Keep changes minimal and explain the root cause.
- Do not automatically merge a PR. Human approval is required before merge.

## Completion report
Always report:
- root cause;
- files changed;
- commands/tests executed;
- exact validation results;
- APK path and artifact availability when Android build succeeds;
- remaining risks or unresolved failures.
