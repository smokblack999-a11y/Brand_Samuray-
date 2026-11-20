# HYBRID Integration — Read-only Source Audit

Audit date: 2026-11-20
Audited repository: `smokblack999-a11y/Brand_Samuray-`
Core baseline: `feat/x10thinc-hamylion-v3` at `e7a1756d09b8a1392dd05a3b320cafeb8adeaf8b`
Audit branch: `feat/hybrid-agentmail-lux-bridge-v1`
Scope: source inspection only; no local Termux access, no runtime execution, no production credentials, no deployment.

## Executive result

The repository contains useful building blocks, but the AgentMail → LUX → Kill Critic → NocoBase path is not implemented. The selected Core branch has an Express API, API-key middleware, local JSON persistence, Dual AI provider adapters, Kill Critic checks, and an optional HAMYLION event bridge. HAMYLION is a separate FastAPI/PostgreSQL/Redis service with event persistence and WebSocket dispatch.

Do not connect real customer mail or enable autonomous outbound actions yet.

## Findings

### H-01 — AgentMail raw-body verification must precede global JSON parsing
Severity: High
Evidence: `core/server.js` installs `app.use(express.json({ limit: "256kb" }))` before route definitions.
Impact: A later webhook route cannot reliably verify the original signed byte sequence if the JSON parser has already consumed/transformed the body.
Required fix: Mount a narrowly scoped `express.raw({ type: "application/json", limit: ... })` route before the global JSON parser, or use a JSON parser verify hook that retains the exact raw bytes. Verify the provider signature before JSON.parse. Add signature, timestamp, malformed-body, and oversize tests.
Status: confirmed by source inspection; no runtime test.

### H-02 — Core JSON file store is not a distributed event ledger
Severity: High
Evidence: `core/store.js` persists leads to `leads.json`; `claimEvent` performs read → search → write with no cross-process transaction or unique database constraint.
Impact: Concurrent workers/instances can race and claim the same event; file writes are not a safe multi-instance idempotency mechanism.
Required fix: Use a durable event ledger with a unique constraint on provider + event_id and transactional state transitions. HAMYLION may be reused only after the queue/worker gaps below are fixed and tested.
Status: confirmed by source inspection; no concurrency test run.

### H-03 — HAMYLION has a database-to-Redis enqueue gap
Severity: High
Evidence: `hamylion-core/backend/app/main.py` commits the PostgreSQL event row, then separately calls `enqueue_event`. If Redis enqueue fails, it marks the event `queue_error` and returns 503.
Impact: The event is durable in PostgreSQL but not in Redis; successful recovery depends on reconciliation/replay. A crash between commit and XADD can leave an event that is never queued automatically.
Required fix: Implement a transactional outbox or a reliable DB sweeper that republishes all eligible unqueued events idempotently. Test crash injection between DB commit and Redis XADD.
Status: confirmed by source inspection; no fault-injection test.

### H-04 — HAMYLION worker trusts project_id from Redis payload
Severity: High
Evidence: `hamylion-core/backend/worker.py` loads the database event by `event_id`, but uses `project_id` from the Redis message for WebSocket broadcast. It does not compare the message project_id to the stored event.project_id.
Impact: A corrupted or forged internal stream entry could route an event to the wrong tenant's WebSocket subscribers.
Required fix: Load the stored event and broadcast only using its authoritative `event.project_id`; reject/quarantine any mismatch between stream and DB values. Add a cross-tenant tampered-message test.
Status: confirmed by source inspection; no exploit/runtime test.

### H-05 — HAMYLION WebSocket API key is accepted in query string
Severity: High
Evidence: `hamylion-core/backend/app/main.py` defines `/v1/ws` with `api_key: str | None = Query(default=None)`.
Impact: Query-string credentials can leak through access logs, reverse-proxy logs, browser history, telemetry, and copied URLs.
Required fix: Prefer a short-lived, single-purpose WebSocket ticket obtained through an authenticated HTTPS POST, or a supported authorization header/subprotocol with strict log redaction. Do not place long-lived API keys in URLs.
Status: confirmed by source inspection; no deployment log review.

### H-06 — HAMYLION delivery is at-least-once, not exactly-once
Severity: Medium
Evidence: Worker dispatches to WebSocket, then marks the event dispatched and ACKs the Redis stream entry. A process crash between broadcast and DB status/ACK can cause a duplicate broadcast after reclaim.
Impact: Consumers may receive duplicate event notifications.
Required fix: Document at-least-once delivery; require consumer-side idempotency keyed by event_id. Do not describe this as exactly-once delivery. Test duplicate dispatch and stale reclaim.
Status: confirmed from worker control flow.

### H-07 — Existing Core Kill Critic is not a full email safety boundary
Severity: High
Evidence: `core/kill-critic.js` checks a small set of unsupported commercial claims (price, availability, discount, deadline, completed action, guarantee). It does not implement email prompt-injection isolation, attachment scanning, source provenance, or policy authorization.
Impact: Calling this function alone is insufficient to make untrusted email content safe or authorize an external side effect.
Required fix: Keep email content in a clearly delimited untrusted-data field; use deterministic allowlists for actions; separate factual verification from text review; require owner approval for all outbound actions in V1.
Status: confirmed by source inspection.

### H-08 — Dual AI is an existing provider workflow, not a deployed LUX service
Severity: Medium
Evidence: `core/dual-ai/providers.js` supports OpenAI, Anthropic, and Ollama; `core/dual-ai/engine.js` orchestrates two agents and a critic. Session persistence uses `core/dual-ai/store.js` JSON files.
Impact: The code demonstrates available AI provider adapters but does not provide a separately deployed LUX API, durable tenant-scoped job system, or AgentMail integration.
Required fix: Build LUX as an isolated service with a narrow authenticated contract, tenant-scoped data, bounded input, structured evidence, and no external side-effect permissions.
Status: confirmed by source inspection.

### H-09 — Current integration boundary is incomplete
Severity: Medium
Evidence: `core/hamylion-adapter.js` sends generic events to `HAMYLION_URL/v1/events`; no AgentMail signature receiver, provider event mapping, message quarantine handling, or NocoBase API contract is implemented in the selected Core tree.
Impact: A generic event bridge is not an email integration.
Required fix: Add a dedicated AgentMail ingress adapter, normalized event envelope, durable provider event ledger, LUX worker contract, and read-only Core API endpoints for NocoBase.
Status: confirmed by source inspection.

## Positive reusable components

- Core API-key middleware uses constant-time comparison after equal-length validation.
- Core has request IDs, request timeout handling, and basic rate limiters.
- Dual AI already has provider adapters and a structured critic verdict schema.
- HAMYLION persists events in PostgreSQL and enforces a unique `(project_id, idempotency_key)` constraint.
- HAMYLION has Redis Streams consumer groups, pending-message reclaim, retry backoff, and dead-letter handling.
- EVOLUTION V3 has a separate PostgreSQL adapter and workspace membership checks; it is not automatically integrated into the selected Core branch.

## Recommended implementation order

1. Confirm the local working tree and exact commit in Termux. Do not cherry-pick or merge anything yet.
2. Fix HAMYLION tenant binding and DB-to-Redis recovery in a dedicated isolated branch, with regression tests.
3. Implement AgentMail raw-body verification and durable event intake as a new module; do not edit existing Core routes until the local diff is reviewed.
4. Add LUX as an isolated worker/service with a typed request/response contract and tenant scope.
5. Route LUX output through Kill Critic plus deterministic evidence validation; owner approval required for any external side effect.
6. Add NocoBase read-only dashboards against a narrow Core API; verify edition/plugin licensing before setup.
7. Run staging end-to-end tests with synthetic mail only.

## Required local verification still outstanding

- `git status --short --branch` and `git rev-parse HEAD` in `~/SamuraiOS`.
- Current local paths for LUX/ONI, AgentMail, and NocoBase experiments.
- `npm test` in the actual local Core checkout.
- Current `/health` and `/ready` status, without exposing API keys or environment values.
- Confirm whether the local working tree differs from the GitHub baseline.

No local files or runtime services were accessed in this audit. No credentials were read. No deployment, webhook registration, mail send, or production data access was performed.
