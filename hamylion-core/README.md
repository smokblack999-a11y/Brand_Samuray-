# HAMYLION Core V3

Portable event infrastructure for X10THINC and other projects.

Implemented:
- PostgreSQL durable event journal;
- Redis Streams consumer group;
- per-project idempotency;
- pending-message reclaim after worker failure;
- bounded exponential retry;
- dead-letter state;
- explicit WebSocket dispatch;
- explicit destination ACK;
- stale unacknowledged event replay;
- HTTP/JavaScript integration surface.

Scope:
- at-least-once event processing;
- explicit client ACK is required before status=delivered;
- no exactly-once guarantee;
- no universal device guarantee.

The service is independent from Telegram, Firebase and frontend technology.

## Local Docker deployment

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD` and `HAMYLION_API_KEY` with different, long, random values.
3. Keep `HAMYLION_BIND_ADDRESS=127.0.0.1` for local-only testing. Do not expose port 8000 directly to the public internet; use a correctly configured TLS reverse proxy and firewall for remote access.
4. From this directory run `docker compose config` to validate interpolation, then `docker compose up --build`.
5. Do not commit `.env` or share its contents.

The compose file intentionally refuses to start if database credentials or the API key are missing. The API port defaults to loopback to avoid accidental public exposure.

## Security and delivery notes

- The API key is a bootstrap credential for the default project; rotate it if exposed.
- The WebSocket endpoint currently accepts the API key as a query parameter. Query strings can appear in access logs and diagnostics. Do not use this endpoint over an untrusted network until a short-lived WebSocket ticket or another non-URL credential flow is implemented.
- Event delivery is at-least-once. Consumers must deduplicate by event ID and acknowledge only after processing.
- A queued event whose enqueue operation failed is marked `queue_error`. Retrying the same idempotency key currently returns the existing event; recovery of `queue_error` records needs a dedicated retry/reconciliation path before relying on this service for critical events.
- A successful Python compile is not a runtime, integration, load, or security test.
