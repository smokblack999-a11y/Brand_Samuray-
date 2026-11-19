# SAMURAI Messenger API (early implementation)

This is the first executable REST API layer for the first-party messenger. It is not yet a production deployment.

## Local bootstrap

1. Create a dedicated PostgreSQL database.
2. Apply `../db/migrations/001_initial_schema.sql`.
3. Copy `.env.example` to `.env`, provide a strong random `JWT_SECRET` (32+ characters), and set `DATABASE_URL`.
4. Run `npm ci`, `npm test`, then `npm start`.

## Implemented endpoints

- `GET /health`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh` (rotates refresh token)
- `GET /v1/me`
- `GET/PATCH /v1/privacy`
- `POST /v1/conversations/direct`
- `GET /v1/conversations`
- `POST/GET /v1/conversations/:id/messages`
- `POST /v1/messages/:id/delivered`
- `POST /v1/messages/:id/read`
- WebSocket upgrade endpoint `/v1/realtime?access_token=...`

Messages are accepted only as opaque ciphertext envelopes. This code does not yet implement a reviewed E2EE protocol or provide client-side encryption/key management. The WebSocket currently authenticates and establishes a connection but does not yet fan out messages. Android client integration, deployment, push, media, groups and calls remain outstanding. Do not expose this service to the public internet until TLS termination, database backups, monitoring, rate-limit persistence, security review and integration tests are in place.
