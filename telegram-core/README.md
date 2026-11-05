# SamuraiOS Telegram Core

An independently deployable Telegram **user-account** service using MTProto via GramJS. It is not a Bot API service. Other apps integrate through a small authenticated HTTP API and do not depend on the Android camera/gallery implementation.

## Scope

- User account sign-in using phone number, Telegram login code, and optional 2FA password.
- Encrypted session persistence (AES-256-GCM); the encryption key is supplied separately through environment configuration.
- Account identity, recent dialogs, message history, text sending, and photo sending.
- Bearer-key protected API, request-size limits, input validation, bounded results, and non-sensitive error responses.
- Independent package and server lifecycle; can later be deployed separately from SamuraiOS Android.

This is an integration foundation, not a claim of complete Telegram feature parity. Calls, secret chats, full update synchronization, notification delivery, drafts, reactions, and every Telegram client behavior are not implemented here yet. A production messenger needs dedicated QA against Telegram's current API behavior.

## Setup

1. Create Telegram API credentials at https://my.telegram.org. Do not use a bot token.
2. Copy `.env.example` to `.env`; set `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, a long random `TELEGRAM_CORE_API_KEY`, and a 32-byte base64 `TELEGRAM_SESSION_KEY`.
3. Keep `.env` out of Git. Use a private host or TLS reverse proxy before allowing non-local connections.
4. Run:

```sh
npm install
npm test
npm start
```

The service binds to loopback by default. The session file contains encrypted account authorization material; protect it as a credential and back it up only in an encrypted secret store.

## API

All routes except `GET /health` require `Authorization: Bearer <TELEGRAM_CORE_API_KEY>`.

- `POST /v1/auth/code` body: `{"phoneNumber":"+..." }`
- `POST /v1/auth/verify` body: `{"phoneNumber":"+...","phoneCodeHash":"...","phoneCode":"..."}`
- `POST /v1/auth/password` body: `{"password":"..."}` (only when Telegram requires 2FA)
- `GET /v1/me`
- `GET /v1/chats?limit=30`
- `GET /v1/chats/:chatId/messages?limit=30`
- `POST /v1/messages` body: `{"chatId":"...","text":"..."}`
- `POST /v1/media/photo` body: `{"chatId":"...","filePath":"/approved/path/photo.jpg","caption":"..." }`

Photo paths are restricted to the configured media root. For production use, prefer a streaming multipart upload endpoint rather than accepting paths from untrusted clients.

## Integration

Android or another backend calls this service over an authenticated API. The camera/gallery layer owns capture, GPS, EXIF, and image overlay. Telegram Core owns account authorization, chats, messages, and media transport. Never send a Telegram session string or session encryption key to Android clients.
