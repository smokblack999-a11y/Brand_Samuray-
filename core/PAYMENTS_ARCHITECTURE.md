# SAMURAI Payments Engine — Architecture V1

## Status

- Provider contract, fail-closed registry, and Stripe test-mode adapter are implemented on this feature branch.
- Official Stripe Node SDK `stripe@23.2.0` is pinned in `package.json` and `package-lock.json`.
- Payments remain disabled by default. The router factory is implemented but is not mounted into `core/server.js`.
- File-backed payment and subscription ledger, webhook event deduplication, retry tracking, and signature-first webhook processing are implemented.
- Delivery and SaaS checkout routes are available through the router factory, but application resolvers and entitlement/fulfillment callbacks are not wired.
- The ledger is single-process JSON storage. It is not safe for multiple Core replicas and is not production-grade transactional storage. The current Core repository does not yet contain authoritative Delivery order or SaaS customer/plan/entitlement stores, so no concrete domain adapter is shipped.
- No real charges, refunds, payouts, or connected-account operations have been performed.

## Jurisdiction decision

The business is stated to be based in Kazakhstan. Stripe's standard merchant onboarding availability does not include Kazakhstan. A US-country Stripe sandbox account is useful for API development only; it is not evidence of a US legal entity or eligibility to process live payments.

Production provider selection must be based on the actual legal entity, settlement bank account, supported currencies, contract, and local regulatory/tax requirements. Do not use false country details or another person's account.

## Architecture

```text
Delivery / SaaS / Admin / Telegram Mini App
                  |
           SAMURAI Core API
                  |
        Payment Application Service
                  |
         Provider Registry
           /           \
     stripe_test     local_provider
       (sandbox)     (future, eligible)
                  |
        Payment Ledger / Webhooks
```

## Provider contract

Every provider adapter implements `createOneTimeCheckout(input)`, `createSubscriptionCheckout(input)`, `verifyWebhook(rawBody, headers)`, `parseWebhook(event)`, `refund(input)`, and `health()`.

## Stripe sandbox adapter

- Uses the official Stripe Node SDK through an injected constructor; no deprecated global API-key state.
- SDK pinned to `stripe@23.2.0`; API version pinned to `2026-11-18.endive`.
- Rejects live keys; requires a test restricted or secret key and a `whsec_` signing secret.
- Delivery Checkout uses order/customer/product/amount/currency data supplied by the trusted server resolver.
- SaaS Checkout accepts a server-owned Stripe Price ID; client-provided prices and amounts are ignored.
- Both flows use idempotency keys and hosted Checkout URLs.
- Omits `payment_method_types` to preserve Stripe dynamic payment methods.
- Webhook verification requires the exact raw request body and Stripe-Signature header.
- Refunds require an internal PaymentIntent reference and idempotency key.
- The adapter is not activated unless payments are explicitly enabled in test mode.

## Runtime and HTTP route foundation

- `createPaymentRuntime()` loads the Stripe SDK only when `PAYMENTS_ENABLED=true`, `PAYMENTS_MODE=test`, and `PAYMENTS_PROVIDER=stripe_test`. Production test mode is blocked by the registry.
- `createPaymentRouter()` exposes authenticated `POST /delivery/checkout`, optional `POST /saas/checkout`, `GET /status`, and signed `POST /stripe/webhook` routes when explicitly mounted.\n- `mountPaymentRoutes()` is wired into `core/server.js` behind `PAYMENTS_HTTP_ENABLED=true`; it also requires explicit Stripe test mode and a complete domain adapter module. The default remains unmounted.
- Delivery Checkout accepts only an order ID. Its server-side resolver must enforce caller ownership, reload the authoritative order, and explicitly return `payable: true`. Amount, currency, product name, and customer ID come only from that resolver.
- The resolver must return a monotonically changing order version or updated timestamp when a new payment attempt is allowed.
- SaaS Checkout accepts only a plan ID. Its server-side resolver must enforce customer ownership and map the plan to a server-owned Stripe Price ID.
- The webhook route requires exact raw request bytes. The existing Core JSON parser captures raw bytes via its `verify` callback; the router factory is not mounted automatically.
- No server routes are active until the application explicitly mounts this router with real resolvers and callbacks.

## Payment and subscription ledger

- Stores payment references, amounts, currency, status, webhook event identifiers, and subscription lifecycle state in a separate JSON file under the configured data directory.
- Uses atomic temp-file replacement and restrictive file permissions. Corrupt data fails closed rather than resetting payment history.
- Claims event IDs once, tracks retries, and prevents completed events from being claimed again.
- Payment state transitions are constrained; a paid payment can move only to refunded.
- Subscription state transitions are constrained and reconciled against the current Stripe Subscription retrieved from Stripe's API. Webhook event timestamps are not treated as a reliable ordering mechanism.
- This is a single-process persistence foundation. Do not run multiple Core replicas against the same JSON file. Before production, migrate to a transactional database with unique constraints on provider event IDs and Checkout Session IDs, plus tested backup/restore.

## Delivery webhook handling

- Verifies Checkout Session mode, metadata, order/customer IDs, amount, currency, and paid status against the ledger.
- An unpaid completed Checkout Session moves the payment to processing, not paid.
- Async success/failure and expired-session events update the local payment state.
- The injected `onDeliveryPaid` callback runs only after the ledger confirms payment. It must be idempotent and must be wired to the actual order fulfillment system before enabling checkout.

## SaaS subscription lifecycle

- Checkout completion creates a local pending subscription using server-side customer/plan metadata and Stripe subscription/customer IDs.
- `invoice.paid` activates access; `invoice.payment_failed` moves the subscription to past-due; subscription update/deletion events synchronize provider state.
- Webhook events are treated as signals: the handler retrieves the current Stripe Subscription and applies its canonical status. This avoids relying on second-resolution event timestamps or delivery order.
- The injected entitlement callback must be idempotent. No access is granted by the Checkout success redirect.
- The SaaS route and lifecycle handlers are implemented as factories but are not connected to the actual SAMURAI customer, plan, or entitlement stores.

## Webhook processing primitive

- Signature verification happens before an event ID is claimed or handled.
- Event IDs are claimed once; duplicate deliveries are acknowledged without re-running the handler.
- Failed handlers are retryable; unknown event types fail explicitly rather than being silently discarded.
- Business handlers independently verify authoritative payment/subscription state and must implement idempotent state transitions.

## Security invariants

- Test credentials only in test environments; production test mode is blocked.
- No live mode implementation in V1.
- Never log API keys, webhook secrets, payment method details, or full raw webhook payloads.
- Never trust amount, currency, customer ID, plan price, or order status from the browser.
- Do not mark an order paid from a browser redirect.
- No card data is stored by SAMURAI.
- Marketplace/Connect transfers and payouts remain out of scope until jurisdiction and legal model are verified.

## Environment

The committed `core/.env.payments.example` is disabled by default. Real sandbox values must remain in local environment or a secret manager and must never be committed.

## Rollout

1. Keep payments disabled.
2. Identify the authoritative Delivery order store and implement a resolver that enforces customer ownership and payable status.
3. Implement idempotent Delivery fulfillment and SaaS entitlement callbacks.
4. Replace the JSON ledger with transactional shared persistence before multi-instance or production use.
5. Mount the router behind existing authentication and rate limiting; preserve all current routes.
6. Run integration tests for duplicate webhooks, stale events, amount/currency mismatches, failed/async payments, refunds, subscription renewals, and cancellation.
7. Verify a Kazakhstan-eligible production provider before enabling live payments.

## Known repository boundary

The older branch `feat/samurai-commerce-stripe-test` contains a prior Commerce + Stripe test implementation but diverges materially from current `main`. It was not merged.
