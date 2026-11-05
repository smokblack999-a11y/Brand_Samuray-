# X10THINC REAL LIFE — Delivery Roadmap

Status: planned; stages are not complete until evidence is attached.

## Phase 0 — Baseline and threat model
- [ ] Inventory existing SamuraiOS/NEXUS/Kill Critic modules.
- [ ] Map current tests, workflows, secrets handling, and connector permissions.
- [ ] Define threat model and authority tiers.
- [ ] Record baseline CI result.
Gate: architecture and scope reviewed; no production writes.

## Phase 1 — Task contract and policy kernel
- [ ] Task schema with goal, scope, budget, deadline, risk, and acceptance criteria.
- [ ] Explicit state machine and transition validation.
- [ ] Deterministic Kill Critic preflight/postflight interfaces.
- [ ] Unit tests for fail-closed policy decisions.
Gate: policy test suite passes.

## Phase 2 — Durable autonomy
- [ ] Persistent queue and checkpoint/recovery.
- [ ] Idempotency keys and transactional outbox.
- [ ] Retry budget and dead-letter queue.
- [ ] Pause, cancel, and kill-switch controls.
Gate: restart and duplicate-side-effect tests pass.

## Phase 3 — Evidence and connectors
- [ ] Append-only evidence ledger and hash-linked manifests.
- [ ] GitHub read-only inspection, isolated branch, draft PR, read-back.
- [ ] Fireflies read-only transcript/summary ingestion with consent and provenance.
- [ ] Redaction, retention, and source attribution.
Gate: connector contract tests and permission tests pass.

## Phase 4 — Control Room
- [ ] Task dashboard and event timeline.
- [ ] Approval queue with exact action preview.
- [ ] Cost and tool-call budgets.
- [ ] Evidence viewer and export.
Gate: end-to-end task can be inspected and stopped by user.

## Phase 5 — Pilot
- [ ] One repository, one bounded task type, one operator.
- [ ] At least 20 representative tasks including failures.
- [ ] Measure verified completion, policy blocks, recovery, cost, and latency.
- [ ] Fix all critical/high findings before expanding scope.
Gate: explicit pilot acceptance; no automatic merge/deploy.

## Release criteria
- All required tests pass in CI.
- Security and dependency scans have no unresolved critical/high findings.
- No secret leakage in repository history or artifacts.
- Every external write has approval, idempotency, and read-back evidence.
- Rollback and incident procedures documented.
