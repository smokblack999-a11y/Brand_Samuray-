# SAMURAI Payments Engine — Architecture V1

## Status

- Official Stripe Node SDK `stripe@23.2.0` is pinned in `package.json` and `package-lock.json`.
- Stripe adapter supports test-mode one-time Delivery Checkout, SaaS subscription Checkout, raw-body webhook signature verification, refunds, and canonical subscription retrieval.
- Payments and HTTP routes are disabled by default. The Core server mounts them only when explicit test-mode flags and a complete domain adapter are configured.
- A concrete Delivery adapter targets the previously drafted Samurai Delivery CRM SQLite schema (`orders`, `payments`, `users`). It opens only an existing database provided via `DELIVERY_CRM_DB_PATH`; it does not create an empty CRM database.
- The Delivery adapter adds a separate `provider_payment_refs` table and transactionally reserves an order as `checkout_pending` before calling Stripe. This blocks the legacy manual-payment confirmation path from racing a Stripe checkout.
- SaaS subscription lifecycle handlers exist, but no real SAMURAI plan/customer/entitlement store or SaaS domain adapter has been connected.
- The provider/webhook ledger remains single-process JSON storage. Delivery order/payment state changes use SQLite transactions against the CRM database. Neither component is approved for multi-instance production use.
- No live charges, refunds, payouts, Connect operations, or live API calls have been performed.

## Jurisdiction decision

The business is stated to be based in Kazakhstan. Stripe's standard merchant onboarding availability does not include Kazakhstan. The selected US-country Stripe sandbox account is useful for API development only; it is not evidence of a US legal entity or eligibility to process live payments.

Production provider selection must be based on the actual legal entity, settlement bank account, supported currencies, contract, and local regulatory/tax requirements. Do not use false country details or another person's account.

## Architecture

```text
Telegram CRM / trusted SAMURAI backend
                  |
           Core API authentication
                  |
       Telegram customer identity
                  |
          Payment HTTP router
                  |
        Payment application service
                  |
           Provider registry
                  |
             stripe_test
                  |
       Stripe signed webhooks
                  |
        Payment webhook processor
                  |
      +-----------+-----------+
      |                       |
Delivery CRM SQLite      Payment JSON ledger
orders/payments          event/payment refs
```

## Provider contract

Every provider adapter implements:
- `createOneTimeCheckout(input)`
- `createSubscriptionCheckout(input)`
- `retrieveSubscription(subscriptionId)`
- `verifyWebhook(rawBody, headers)`
- `parseWebhook(event)`
- `refund(input)`
- `health()`

## Stripe sandbox adapter

- Uses the official Stripe Node SDK through an injected constructor.
- SDK pinned to `stripe@23.2.0`; API version pinned to `2026-11-18.endive`.
- Rejects live keys; requires a test restricted or secret key and a `whsec_` signing secret.
- Delivery Checkout uses order/customer/product/amount/currency data supplied by the trusted server resolver.
- SaaS Checkout accepts a server-owned Stripe Price ID; client-provided prices and amounts are ignored.
- Both flows use idempotency keys and hosted Checkout URLs.
- Webhook verification requires the exact raw request body and Stripe-Signature header.
- Subscription webhooks retrieve the current Stripe Subscription instead of trusting stale event snapshots or event timestamps.
- Refunds require an internal PaymentIntent reference and idempotency key.
- The adapter is not activated unless payments are explicitly enabled in test mode.

## Runtime and HTTP route foundation

- Core requires Node.js `>=22.13.0` for built-in `node:sqlite`. Node documents this module as experimental/release-candidate; this dependency is isolated in the optional Delivery adapter and payment activation remains disabled by default.
- `createPaymentRuntime()` loads the Stripe SDK only when `PAYMENTS_ENABLED=true`, `PAYMENTS_MODE=test`, and `PAYMENTS_PROVIDER=stripe_test`. Production test mode is blocked.
- `mountPaymentRoutes()` is wired into `core/server.js` behind `PAYMENTS_HTTP_ENABLED=true`. Server startup validates test-only flags before opening the CRM database.
- The Delivery checkout route requires both the existing Core API key and a trusted server-supplied `X-SAMURAI-Telegram-User-ID` header. The ID must be provided by a trusted backend, not an unauthenticated browser.
- The resolver loads an order using both order ID and Telegram user ID. A guessed order ID cannot cross customer ownership.
- Checkout accepts only an order ID. Amount, currency, product name, and customer ID come only from the authoritative SQLite order.
- SaaS Checkout is mounted only if both a real server-side plan resolver and entitlement callback are provided.
- The webhook route requires exact raw request bytes. Existing Core JSON parser captures raw bytes via its `verify` callback.
- No payment routes are active unless all activation flags are explicitly set.

## Delivery CRM SQLite adapter

Module: `core/payments/delivery-crm-sqlite-adapter.js`.

- Requires `DELIVERY_CRM_DB_PATH` to point to an existing absolute path.
- Requires the legacy `orders` and `payments` tables with their expected fields. Missing schema fails startup; it does not create fake orders.
- Adds a separate `provider_payment_refs` table for SAMURAI payment IDs, Stripe Checkout Session IDs, PaymentIntent IDs, amount in KZT minor units, checkout revision, and provider state.
- Before the Stripe API call, a `BEGIN IMMEDIATE` transaction creates a `provider_pending` payment row, records the deterministic payment ID, and changes the order to `checkout_pending`.
- Repeated requests reuse the same checkout revision and idempotency key. A definitive Stripe 4xx response or signed failed/expired webhook marks the attempt failed and returns the order to `awaiting_payment`. Network/5xx ambiguity keeps the order reserved so a retry can reuse the same idempotency key.
- After a signed paid webhook, a SQLite transaction verifies the order/customer/session/amount/currency mapping, approves the payment row, marks the provider reference paid, and transitions the order to `paid`.
- The legacy bot may display `checkout_pending` as a raw status until its `STATUS_LABELS` map is updated. Do not map it to paid.
- The adapter assumes the Telegram bot/backend keeps the Core API key private and forwards the authenticated Telegram user ID in the header.

## Payment and subscription ledger

- Stores payment references, amounts, currency, status, webhook event identifiers, and subscription lifecycle state in a separate JSON file under the configured data directory.
- Uses atomic temp-file replacement and restrictive file permissions. Corrupt data fails closed rather than resetting payment history.
- Completed event IDs are deduplicated. An event already processing returns a retryable server error; stale processing claims can be reclaimed after a bounded lease.
- Payment state transitions are constrained; a paid payment can move only to refunded.
- Subscription state transitions are constrained and reconciled against the current Stripe Subscription retrieved from Stripe's API.
- The JSON ledger is single-process only. Do not run multiple Core replicas against the same file. Before production, migrate it and the webhook inbox to a transactional shared database with unique constraints on provider event IDs, Checkout Session IDs, and payment IDs.

## Webhook processing limitation

The current processor runs synchronously inside the HTTP request and the JSON ledger is not a durable queue. Stripe recommends returning 2xx quickly before complex processing. A production rollout requires a durable transactional inbox and background worker, with retries and dead-letter handling. This is not claimed as production-ready.

## SaaS subscription lifecycle

- Checkout completion and subscription-created events link Stripe subscription/customer IDs to SAMURAI customer/plan metadata.
- `invoice.paid`, `invoice.payment_failed`, subscription update, and deletion events reconcile against the current provider subscription state.
- The entitlement callback must be idempotent. No access is granted by a Checkout success redirect.
- No real SAMURAI SaaS customer, plan, or entitlement store is present in the current Core repository; SaaS Checkout stays unmounted until that domain adapter exists.

## Security invariants

- Test credentials only; production test mode is blocked.
- Never log API keys, webhook secrets, payment method details, or full raw webhook payloads.
- Never trust amount, currency, customer ID, plan price, or order status from the browser.
- Never mark an order paid from a browser redirect.
- No card data is stored by SAMURAI.
- Marketplace/Connect transfers and payouts remain out of scope until jurisdiction and legal model are verified.

## Environment

`core/.env.payments.example` is disabled by default. Real sandbox values must remain in local environment or a secret manager and must never be committed.

## Rollout

1. Keep payments disabled until the existing Delivery CRM database path and private Core API key are configured.
2. Add `checkout_pending` to the Telegram CRM bot's status labels so operators see the in-progress state clearly.
3. Test with a copy of the existing CRM SQLite database first; do not point at the only live database during initial integration tests.
4. Connect a real SaaS plan/customer/entitlement store before enabling SaaS Checkout.
5. Replace the JSON payment ledger and synchronous webhook handler with a transactional shared database and durable worker before multi-instance or production use.
6. Verify a Kazakhstan-eligible production provider before enabling live payments.

## Known repository boundary

The previous CRM bot code was drafted separately and was not confirmed running end-to-end or committed as a complete module in this repository. The adapter therefore targets its known SQLite schema but requires the actual existing database file to be supplied at runtime.
