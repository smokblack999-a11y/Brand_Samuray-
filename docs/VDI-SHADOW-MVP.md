# SAMURAI VDI — Shadow MVP

**Implementation status:** isolated deterministic engine and automated unit tests added on a feature branch. No server route, vendor adapter, live feed, customer data, deployment or paid pilot is included or claimed.

## Customer problem to validate

Operators may need to reconcile inconsistent ANPR/access events, duplicate deliveries, missing sessions and disputed vehicle movements across existing vendors. This is a hypothesis until an operator confirms frequency, cost and budget ownership.

## What this slice does

- Validates a canonical vehicle event contract.
- Verifies source HMAC signatures over exact raw request bytes.
- Routes uncertain, stale, unauthenticated, duplicate or conflicting events to REVIEW.
- Allows only a validated event with explicit positive checks to receive ALLOW.
- Produces a tamper-evident, hash-chained proof receipt.
- Keeps all decisions in SHADOW_ONLY; it never opens barriers, denies physical access, charges money or claims fraud.

## Deliberate exclusions

- No Express route or production server wiring.
- No camera/OCR integration or vendor adapter.
- No persistent database or multi-process ledger coordination.
- No production secrets, customer records or plate text.
- No automatic DENY policy in this first slice.
- No AI model in the decision path.

The JSONL proof ledger is for a single-process local pilot harness only. It is not a distributed ledger and must not be shared by multiple writers. Before multi-instance use, replace it with a transactional store and enforce a unique constraint on (site_id, source_id, event_id).

## Run locally

```bash
cd core
node --test vdi/index.test.js
npm test
```

## Acceptance gates before a customer pilot

1. One named operator confirms the problem and provides a lawful, read-only sample export.
2. Customer and vendor agree on event semantics, source authentication and retention.
3. Ground-truth labels are supplied by the operator; measure false-ALLOW, false-REVIEW and review rate.
4. Replaying the same input produces the same decision and evidence hash (excluding evaluation timestamp).
5. Duplicate event delivery never creates a second proof receipt.
6. Ledger tampering is detected; backup, retention and access controls are documented.
7. P95 local processing latency is measured on representative data; do not present a target as a result.
8. No physical action is enabled during the shadow pilot.

## Commercial validation

Interview five operators. Proceed only if at least one can quantify manual reconciliation time, disputed events, missed revenue or operational cost, and identifies a budget owner. Pricing remains unvalidated until a buyer accepts a written paid-pilot proposal.

## Security notes

- Use a different random secret per source; minimum 32 characters.
- Store secrets outside the repository.
- Verify HMAC over exact raw request bytes before parsing JSON.
- Use TLS at ingress.
- Keep plate data out of logs; prefer customer-approved pseudonymous tokens.
- The hash chain detects modification but does not prevent an attacker with write access from rewriting the entire file. Protect the ledger with OS permissions, backups and external checkpoints.
