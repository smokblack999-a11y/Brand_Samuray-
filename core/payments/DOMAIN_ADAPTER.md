# SAMURAI Payments Domain Adapter Contract

The Delivery integration now includes a concrete adapter for the existing Samurai Delivery CRM SQLite schema. The SaaS adapter remains optional until real plan/customer/entitlement records exist.

## Delivery CRM SQLite adapter

Module: `core/payments/delivery-crm-sqlite-adapter.js`

Configure:

```dotenv
PAYMENTS_HTTP_ENABLED=true
PAYMENTS_DOMAIN_ADAPTER_MODULE=./payments/delivery-crm-sqlite-adapter.js
DELIVERY_CRM_DB_PATH=/absolute/path/to/existing/data/crm.sqlite3
PAYMENTS_ENABLED=true
PAYMENTS_MODE=test
PAYMENTS_PROVIDER=stripe_test
```

The configured SQLite file must already exist and contain the expected legacy CRM tables/columns:
- `orders(id, uid, total, status, updated)`
- `payments(id, order_id, uid, amount, method, status, ts)`

The adapter does not create an empty CRM database. It adds only a separate `provider_payment_refs` table for provider IDs, Stripe session/payment-intent references, KZT minor-unit amount, checkout revision, and provider state.

### Customer ownership

The route requires the Core API key and `X-SAMURAI-Telegram-User-ID`. The latter must be supplied by a trusted server-side Telegram bot/backend, never directly trusted from an unauthenticated browser. The adapter loads the order using both `orders.id` and `orders.uid`.

### Amount conversion

The legacy CRM stores integer KZT amounts (for example, `orders.total`). Stripe treats KZT as a two-decimal currency, so the adapter converts the whole-KZT order total to Stripe minor units by multiplying by 100. The conversion is verified again against the authoritative order when the signed webhook is processed. <https://docs.stripe.com/currencies>

### Safe checkout reservation

Before creating a Stripe Checkout Session, the adapter transactionally:
1. Verifies the order belongs to the authenticated Telegram user and is `awaiting_payment`.
2. Creates a `payments` row with method `stripe_test` and status `provider_pending`.
3. Creates a provider reference using the deterministic SAMURAI payment ID and checkout revision.
4. Moves the order to `checkout_pending`.

This blocks the existing CRM's manual `confirm_payment` path, which only confirms orders still in `awaiting_payment`. Repeated checkout requests reuse the same payment revision and Stripe idempotency key. A definitive provider 4xx error or a signed failed/expired webhook marks the attempt failed and returns the order to `awaiting_payment`. Network/5xx ambiguity deliberately leaves the order reserved for a retry with the same idempotency key.

After a signed paid webhook, the adapter uses one SQLite `BEGIN IMMEDIATE` transaction to verify the CRM order/payment/session/amount/currency mapping, approve the payment row, mark the provider reference paid, and move the order to `paid`. Repeated paid events are idempotent.

The legacy Telegram bot may display the new `checkout_pending` status as a raw status string until its `STATUS_LABELS` map is updated. The state is intentional; do not map it to `paid`.

## SaaS adapter

SaaS Checkout remains disabled unless the configured domain adapter also exports both:
- `resolveSaasPlan(planId, request)`
- `onSubscriptionStatusChange(subscriptionRecord, stripeEvent)`

Those functions must resolve a real SAMURAI customer and server-owned Stripe Price ID, and update a real entitlement store idempotently. No placeholder plan or fake entitlement is included.

## Runtime compatibility

Core requires Node.js `>=22.13.0` for the built-in `node:sqlite` module. Node documents this module as experimental/release-candidate; payment activation remains explicitly test-only and disabled by default.
