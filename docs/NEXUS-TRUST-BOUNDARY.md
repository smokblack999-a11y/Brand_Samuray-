# NEXUS runner evidence trust boundary

## Current safe state

The public `sandbox`, `ci`, and `proof` endpoints return HTTP 503 with
`TRUSTED_RUNNER_ADAPTER_NOT_CONFIGURED`. They do not accept caller-supplied
`passed: true`, `conclusion: success`, or a client-generated proof as evidence.

NEXUS diagnosis and repair proposal endpoints remain separate. A proposed repair
cannot advance to a proof-ready or review-ready state through the disabled public
evidence routes.

## What is required to re-enable progression

1. A trusted runner adapter that executes the exact candidate commit in isolation.
2. HMAC-signed evidence bound to repository, job ID, before/after commit SHA,
   changed-file set, runner identity, check ID, status, timestamps, and artifact digest.
3. Server-side verification against a trusted runner identity allowlist.
4. Replay protection and idempotency for runner evidence.
5. Integration tests proving unsigned, stale, cross-job, cross-repository, and
   replayed evidence is rejected.
6. Exact-commit GitHub Actions verification and human review.

The existing HARD988 evaluator is not sufficient by itself to establish the
complete job-binding and replay-protection contract. Do not re-enable these routes
until the adapter and binding checks are implemented and tested.

No merge, deployment, or autonomous write is enabled by this change.
