# Kill Critic Vehicle Decision Integrity (VDI)

**Status: specification only. Not implemented, not piloted, not commercially validated.**

## Product thesis

Vendor-neutral validation and evidence layer between existing ANPR/access/parking software and consequential action. It does not replace cameras, OCR, barriers, payment systems or access-control systems.

Initial wedge: one private commercial parking site OR one controlled logistics yard in Kazakhstan. Do not build both verticals in v1.

## Pipeline

`Existing ANPR/access → adapter → canonical event → deterministic policy → Kill Critic evidence challenge → ALLOW | REVIEW | DENY → (shadow mode only) → Proof Ledger`

MVP must not actuate barriers or capture payments. AI may flag ambiguity but cannot override deterministic policy.

## Event contract v1

Required: `event_id`, `source_id`, `event_type`, `occurred_at`, `received_at`, `site_id`, `lane_id`, `source_payload_hash`.

Optional/restricted: `plate_token` (HMAC pseudonym), encrypted `plate_text`, `ocr_confidence`, `source_sequence`, protected `evidence_ref`.

Reject malformed/unauthenticated events; enforce idempotency, timestamp tolerance and source registry. Never trust source timestamps alone.

## Decision contract

Return `decision_id`, `event_id`, `decision`, `reason_codes[]`, `policy_version`, `evaluated_at`, `latency_ms`, `evidence_hash`, `requires_human_review`.

- ALLOW: all mandatory checks pass.
- REVIEW: ambiguity, conflicting sensors, low OCR quality, stale authorization or missing evidence.
- DENY: explicit policy violation supported by reliable evidence.
- System-integrity failures fail closed; ambiguous vehicle evidence goes to REVIEW / agreed safe fallback, not automatic punitive denial.

## MVP modules

1. Authenticated REST intake, request IDs, rate limits and idempotency.
2. Canonical schema + replay/import adapter.
3. Deterministic versioned policy engine.
4. Duplicate/replay and event-order validation.
5. One workflow: parking session reconciliation OR yard checkpoint state machine.
6. Shadow decision API; no physical action.
7. Append-only, tamper-evident Proof Ledger.
8. Operator review endpoint.
9. Metrics, structured logs, retention/access controls.
10. Docker, integration guide, unit/integration/security/replay tests.

## Initial rules

- duplicate source/event ID → deduplicate + audit;
- stale event → REVIEW;
- low OCR confidence or conflicting reads → REVIEW;
- missing matched parking session / appointment → REVIEW or customer-configured DENY;
- payment mismatch → REVIEW, never infer fraud;
- unauthorized source/signature → reject processing;
- unexplained manual override → REVIEW + audit;
- impossible event sequence → REVIEW;
- unavailable required evidence → REVIEW.

## API proposal

- `POST /v1/events`
- `POST /v1/events/replay` (test/shadow only)
- `GET /v1/decisions/{decision_id}`
- `GET /v1/sessions/{session_id}`
- `POST /v1/reviews/{decision_id}`
- `GET /v1/proofs/{decision_id}`
- `GET /health`, `GET /ready`, `GET /metrics`

Raw plate data is never returned by default.

## Proof Receipt

Include schema version, site/source IDs, event ID + canonical payload hash, pseudonymous vehicle token, decision/reasons, policy version/hash, evidence refs/hashes, validation results, timestamp/latency, operator override metadata, previous receipt hash and current receipt hash.

Receipt proves what was evaluated and decided. It does not prove physical actuation/payment unless a separately verified acknowledgement is attached.

## 30-day pilot

- Days 1–5: one site discovery, event mapping, written authorization/data basis, baseline metrics.
- Days 6–12: offline replay, customer-labelled ground truth, false-positive/negative and review-rate measurement.
- Days 13–20: live read-only shadow mode; no barrier/payment control.
- Days 21–30: acceptance report, deterministic replay demonstration, quantified ROI, production proposal only if accepted.

Provisional criteria: every accepted event has a stable ID/outcome; duplicate delivery never duplicates a session/action; decisions reproduce from event + policy version; all REVIEW/DENY decisions have reason codes; no actuation in shadow mode; measure P95 latency (target <500ms local processing excluding upstream ANPR); measure false-ALLOW and false-DENY against labelled sample.

## Kill Gate

Stop/reposition if:
1. existing vendor already solves reconciliation/audit at acceptable cost;
2. no read-only event export/integration;
3. no lawful/contractually approved processing basis;
4. no quantified baseline loss or operator burden;
5. error rates exceed customer tolerance;
6. integration requires replacing hardware or destroys unit economics;
7. no budget owner agrees to paid pilot after 20 qualified conversations + 5 technical discovery calls.

## Pricing hypothesis (not validated)

- diagnostic/data mapping: 150k–300k KZT;
- 30-day read-only pilot: 500k–1.2M KZT;
- single-site production: 1.5M–3.5M KZT;
- software/support: 70k–200k KZT/site/month.
Prices are hypotheses, not quotes or forecasts. Hardware/vendor licenses excluded.

## Backlog

### P0
- [ ] Event JSON Schema + versioning
- [ ] Authenticated idempotent intake
- [ ] Event store + replay
- [ ] Deterministic policy evaluator
- [ ] Duplicate/replay + timestamp checks
- [ ] Select exactly one workflow (parking OR yard)
- [ ] Proof receipt + append-only hash chain
- [ ] Decision retrieval + operator review
- [ ] Unit/integration/security/replay determinism tests
- [ ] Docker, runbook, metrics

### P1
- [ ] First customer vendor adapter
- [ ] Shadow-mode comparison report
- [ ] RBAC + retention
- [ ] Labelled benchmark
- [ ] Audit export

### P2 (after paid pilot only)
- [ ] Second vendor adapter
- [ ] Supervised action adapter + hardware acknowledgements
- [ ] Multi-site tenancy + billing
- [ ] Advanced anomaly detection

## Existing implementation boundary

Repository `smokblack999-a11y/Brand_Samuray-` currently has a generic dual-AI Kill Critic and NEXUS state/policy/proof architecture. The existing `core/dual-ai/critic.js` reviews task/answer text; it is **not** a vehicle-event policy engine. Build VDI as an isolated module and do not change existing production paths until tests and a reviewed PR exist.

## Evidence ledger

- GitHub repository and source files were inspected.
- Fireflies searches for ANPR/parking returned no matching transcripts.
- HubSpot company searches for ANPR/parking returned no matching records; Company/Contact/Deal writes require additional permissions.
- Inductive's available models are molecular/ADMET and are not relevant to VDI.
- No live vehicle feed, customer dataset, pilot, customer demand, or revenue has been verified.
