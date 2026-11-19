# SAMURAI Messenger API deployment

This stack starts PostgreSQL 16 and the API. It does not include the Android client, push provider, media object storage, calls, or a reviewed E2EE protocol.

## Prepare secrets

From this directory:

```bash
cp .env.example .env
openssl rand -hex 32
openssl rand -base64 48
```

Use fresh random values for `JWT_SECRET` and `POSTGRES_PASSWORD`; do not commit `.env`.

## Start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

The API health endpoint is `http://127.0.0.1:8790/health` when using the example bind address. PostgreSQL is not published to the host. The schema is applied automatically on first database initialization.

## Android test on the same private Wi-Fi

Set `MESSENGER_BIND=0.0.0.0` in the deployment `.env`, restart the stack and point the Android **debug** APK to `http://LAN-IP-OF-SERVER:8790`. Only debug builds permit cleartext for local test networks. Keep the API behind a trusted private Wi-Fi network and firewall; do not expose this port to the public internet.

For internet deployment, place the API behind HTTPS/TLS, set `MESSENGER_BIND=127.0.0.1` or a private container network, and use the HTTPS URL in the Android release app. Add backups, monitoring, rate-limit persistence, retention policy and a security review first.

## Important current limitations

- The application uses a manually shared conversation passphrase for an early AES-GCM message envelope. This is not independently audited E2EE and has no forward secrecy/key rotation.
- WebSocket currently authenticates the session and sends message-available notifications; clients still fetch message envelopes over REST.
- No push delivery, media object storage, group management or calls are included.
- Production API security review and two-device acceptance are mandatory before general release.
