# VDI Shadow HTTP Adapter

## Scope

The adapter in core/vdi/http.js exports an Express-compatible ingestion handler. It is deliberately not mounted in core/server.js in this MVP. This keeps the feature isolated until a vendor event contract, source-secret lifecycle, retention policy, and operator-provided session matcher are reviewed.

## Required integration contract

- Capture exact request bytes in req.rawBody before JSON parsing (the current Core JSON middleware already does this).
- Supply a source HMAC secret of at least 32 characters and the append-only proof ledger.
- Set enabled: true explicitly; otherwise the handler returns 404.
- Verify X-VDI-Signature as HMAC-SHA256 over the exact raw request bytes.
- A session matcher must return literal boolean true for session-match evidence. Missing, false, thrown, or indeterminate results produce REVIEW.
- The adapter emits only shadow decisions and proof receipts. It never opens barriers, denies entry, charges customers, or triggers physical actions.

## HTTP outcomes

| Status | Meaning |
| --- | --- |
| 200 | Event evaluated and proof receipt appended |
| 400 | Missing raw bytes or malformed JSON |
| 401 | HMAC signature invalid |
| 404 | Feature disabled |
| 422 | Event schema/time validation failed |
| 503 | Missing configuration, session/proof dependency failure |

## Explicit non-goals

- No route is mounted in the live Core server.
- No vendor-specific ANPR adapter or camera connection.
- No production key rotation, per-source secret registry, multi-process ledger, or database durability.
- No customer data, real license plates, or production secrets in tests.
- No automated physical access decision.

## Pilot gate

Before mounting a route: agree a versioned vendor event contract; implement per-source key lookup and rotation; define replay/retention controls; provide a lawful read-only sample with ground-truth labels; measure false-ALLOW, false-REVIEW, review rate, duplicate rate, and P95 latency. Keep physical actions out of the pilot.
