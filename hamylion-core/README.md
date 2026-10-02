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
