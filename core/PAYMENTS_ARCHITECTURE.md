# SAMURAI Payments Engine — Architecture V1

## Status

- Provider contract and isolated Stripe test-mode adapter exist on this feature branch.
- Payments remain disabled by default; no HTTP checkout or webhook routes are mounted.
- Adapter requires the official Stripe Node SDK constructor to be injected by the application.
- The SDK dependency and lockfile have deliberately not been changed because dependency installation and lockfile regeneration have not yet been run in a repository checkout.
- No order fulfillment, subscription entitlements, durable event ledger, refunds workflow, or local Kazakhstan provider is wired.
- No real charges, payouts, refunds, or connected-account operations have been performed.

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

- Uses an injected official Stripe Node SDK constructor; no deprecated global API-key state.
- API version pinned to `2026-11-18.endive`.
- Rejects live keys; requires a test restricted or secret key and a `whsec_` signing secret.
- Delivery Checkout accepts amount, currency, order and customer identifiers from the trusted server layer.
- SaaS Checkout accepts a server-owned Stripe Price ID; client-provided amounts are not accepted.
- Both flows use idempotency keys and hosted Checkout URLs.
- Omits `payment_method_types` to preserve dynamic payment methods.
- Webhook verification requires the exact raw request body and Stripe-Signature header.
- Refunds require an internal PaymentIntent reference and idempotency key.
- Adapter is not wired into `server.js`; its presence does not mean payments are operational.

## Initial business flows

### Delivery — one-time payment

1. Server loads the order and authoritative amount/currency.
2. Server creates a provider checkout using an idempotency key.
3. Client receives only a hosted checkout URL and public reference.
4. Provider webhook signature is verified against the raw request body.
5. Event ID is persisted uniquely before state transition.
6. Server verifies order ID, customer ownership, amount, currency, provider account, and payment status.
7. Order transitions to paid exactly once; only then can fulfillment begin.
8. Refunds are recorded as ledger entries and reconciled with provider state.

### SaaS — recurring subscription

1. Server maps a plan identifier to a server-owned provider price.
2. Client cannot supply arbitrary amounts or recurring intervals.
3. Subscription checkout is created with an idempotency key.
4. Webhooks drive entitlement state: checkout completion, invoice paid/failed, subscription updated/deleted.
5. Access is derived from the local subscription/entitlement record, not the success redirect.
6. Cancellation, grace period, retries, and plan changes are explicit state transitions.

## Security invariants

- Test credentials only in test environments; production test mode is blocked by the provider registry.
- No live mode implementation in V1.
- Never log API keys, webhook secrets, payment method details, or full raw webhook payloads.
- Webhook signature verification uses the exact raw request body.
- Event IDs must be stored uniquely; handlers must be idempotent.
- Never trust amount, currency, customer ID, plan price, or order status from the browser.
- Do not mark an order paid from a browser redirect.
- No card data is stored by SAMURAI.
- Marketplace/Connect transfers and payouts remain out of scope until jurisdiction and legal model are verified.

## Environment contract

```env
PAYMENTS_ENABLED=false
PAYMENTS_MODE=disabled
PAYMENTS_PROVIDER=disabled
```

For isolated development only, select `stripe_test` with `PAYMENTS_MODE=test` only after installing the official SDK, a durable event ledger, and the raw-body webhook route.

## Rollout

1. Keep the feature isolated and disabled.
2. Add the official Stripe Node SDK and regenerate `package-lock.json` in a real repository checkout.
3. Add durable webhook event persistence and payment ledger before enabling fulfillment.
4. Integrate HTTP routes behind feature flags and preserve existing routes.
5. Add a Kazakhstan-eligible local provider only after verifying official merchant onboarding, supported settlement, refund, recurring-payment, and webhook capabilities.
6. Run unit, integration, webhook replay, duplicate-event, amount-mismatch, currency-mismatch, failure, and refund tests.
7. Review the PR; do not merge or enable production without explicit approval and live legal/payment readiness.

## Known repository boundary

The older branch `feat/samurai-commerce-stripe-test` contains a prior Commerce + Stripe test implementation but diverges materially from current `main` (94 commits ahead and 72 behind at audit time). It must not be merged wholesale.
