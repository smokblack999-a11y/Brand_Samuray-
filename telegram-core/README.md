# Telegram Core

Reusable Telegram **user-account client** module for Android and other host applications.

This is not a Telegram Bot API wrapper. The target is a normal user account through Telegram's official client API/TDLib.

## Scope

- Phone/code/password/2FA authorization flows supported by TDLib
- Session persistence and explicit logout
- Dialogs, private chats, groups, supergroups and channels
- Incoming/outgoing messages and message history
- Photo, video, document and multi-media transfers
- Upload/download progress, retries and connection state
- Update synchronization and notification integration points
- A host-independent API; Camera/Gallery/SamuraiOS must not depend on TDLib internals

## Architecture

```text
Host application (Android / another app)
            |
     TelegramCore API
            |
   TDLib adapter (real implementation)
            |
 Telegram servers / user account
```

The core owns client lifecycle and translates TDLib updates into stable domain events. UI, camera, gallery and product-specific workflows stay outside the core.

## Security requirements

- Never ship `api_hash`, phone numbers, login codes, passwords, or session files in source control.
- Do not send Telegram credentials/session data to a SamuraiOS backend.
- Store local TDLib database/files in app-private storage; use Android backup exclusions and device-protected encryption where supported.
- Require explicit user consent before login; provide logout/session removal.
- Treat authorization states and rate limits as first-class states, not generic success.
- Keep API credentials in local build/runtime configuration. Telegram API credentials are not equivalent to bot tokens, and a client must comply with Telegram's API terms.

## Status

**Foundation only — not yet a working Telegram client.** This branch starts the separable module and its contract. TDLib/native packaging, real authorization, messaging, media, tests and Android end-to-end validation remain required before calling it complete.

## Official references

- TDLib: https://core.telegram.org/tdlib
- Getting started: https://core.telegram.org/tdlib/getting-started
- Telegram API terms: https://core.telegram.org/api/terms

## Current branch

`telegram-core-foundation` in the SamuraiOS repository. The directory is deliberately isolated so it can later be extracted into its own repository without changing the public API.