# SAMURAI Core Hardening V1

## Scope
Adds an isolated append-only durable queue primitive. The existing HTTP webhook and lead store are intentionally unchanged; this branch does not yet enable the queue in production.

## Guarantees
- Enqueue is appended and fsynced before acceptance.
- Idempotency keys suppress duplicate enqueue after restart.
- Pending items are replayed after restart.
- Acknowledgements and retry/dead-letter transitions are persisted.
- A torn final log line is ignored; corruption in a completed record fails closed.

## Limitations
- Single process/worker only; no cross-process lock or distributed lease.
- No log compaction, encryption at rest, or multi-host coordination.
- Use a private local filesystem and do not share one queue file across replicas.
- Retry scheduling/backoff and HTTP integration are not implemented yet.

## Verification
Tests are authored in durable-queue.test.js but have not been executed in this environment. No production readiness claim is made.