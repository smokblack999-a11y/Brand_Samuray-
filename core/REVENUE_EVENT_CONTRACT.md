# Samurai Revenue Event Contract

The revenue control plane uses immutable event identities and correlation IDs.

## Canonical envelope

```json
{
  "eventId": "provider-or-system-unique-id",
  "tenantId": "tenant-123",
  "correlationId": "lead-or-loop-id",
  "occurredAt": "2026-10-03T18:00:00Z",
  "type": "revenue.decision.created",
  "schemaVersion": 1,
  "payload": {}
}
```

## Events

`revenue.decision.created` records X26 action selection and expected incremental profit.

`revenue.action.executed` records the action actually attempted and provider/model telemetry.

`revenue.outcome.recorded` records WON/LOST/UNKNOWN/REFUNDED/CANCELLED business outcome.

`revenue.attribution.recorded` records the attribution policy and incremental share used.

`revenue.learning.recorded` records forecast error and realized economics used for calibration.

`revenue.budget.blocked` records when cost governance suppresses execution.

## Idempotency

Consumers must deduplicate on `(tenantId,eventId)`. Producers must never reuse an eventId for a different payload. Correlation IDs tie decision, execution, outcome and learning together.

## Scaling rule

Redis/stream transport may carry these events, but PostgreSQL remains the authoritative business ledger. Transport duplication or reordering must not change the final accounting result.
