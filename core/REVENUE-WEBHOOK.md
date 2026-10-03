# Real-money outcome ingestion

Samurai can ingest authoritative business outcomes from a CRM, payment service, billing system, or internal order service without coupling the revenue engine to one vendor.

## Endpoint

POST /api/revenue/webhook/:provider

Required header:

X-Samurai-Signature: sha256=<HMAC-SHA256>

The signature is calculated over Samurai's canonical JSON representation of the request body using the tenant webhook secret.

## Minimum payload

{
  "tenantId": "tenant-123",
  "eventId": "payment_123",
  "status": "WON",
  "amountKZT": 250000,
  "currency": "KZT"
}

Optional correlation fields: actionId, customerId, externalReference, occurredAt, grossMarginRate, baselineConversionProbability, controlConversionProbability, treatmentConversionProbability, attributionPolicy.

Security: for multi-tenant deployments use REVENUE_WEBHOOK_SECRETS_JSON to bind each tenant to a distinct secret. Do not use a shared global secret for unrelated tenants.

The webhook is idempotent through eventId. Duplicate delivery returns the existing outcome rather than creating a second revenue event.

Recommended flow:

Payment/CRM → signed webhook → Revenue Outcome → Attribution → Learning → Genome → next X26 decision.

The provider remains the source of truth for whether money was actually paid. Samurai does not infer payment merely from a sent message or AI response.