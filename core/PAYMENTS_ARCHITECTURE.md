# SAMURAI Payments Engine — Architecture V1

## Status

- Architecture foundation only; not wired into HTTP routes or order fulfillment.
- Feature disabled by default.
- Test mode only. Live mode is explicitly rejected.
- No real charges, payouts, refunds, or connected-account operations.
- Existing Core routes and payment-proxy behavior are not changed by this foundation.

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

The provider adapter is deliberately independent of business order state. Delivery orders and SaaS entitlements must be fulfilled only from verified, idempotently processed provider events and server-side state checks.

## Provider contract

Every provider adapter implements:

- `createOneTimeCheckout(input)`
- `createSubscriptionCheckout(input)`
- `verifyWebhook(rawBody, headers)`
- `parseWebhook(event)`
- `refund(input)`
- `health()`

A provider must not be considered ready merely because credentials exist. Health checks must report environment/mode and capability state without exposing secrets.

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

- Test credentials only in test environments.
- No live mode implementation in V1.
- Never log API keys, webhook secrets, payment method details, or full raw webhook payloads.
- Webhook signature verification uses the exact raw request body.
- Event IDs are unique; handlers are idempotent.
- Never trust amount, currency, customer ID, plan price, or order status from the browser.
- Checkout URLs are returned only to the authenticated owner of the order/session.
- Do not mark an order paid from a browser redirect.
- No card data is stored by SAMURAI.
- Marketplace/Connect transfers and payouts remain out of scope until jurisdiction and legal model are verified.

## Environment contract

```env
PAYMENTS_ENABLED=false
PAYMENTS_MODE=disabled
PAYMENTS_PROVIDER=disabled
```

For isolated development only, the future Stripe adapter may be selected as `stripe_test` with `PAYMENTS_MODE=test`. The provider registry currently does not ship a Stripe adapter, local provider, HTTP routes, or webhook endpoint.

## Rollout

1. Keep this provider contract isolated and disabled.
2. Implement and test the Stripe sandbox adapter independently.
3. Implement webhook persistence and payment ledger before enabling fulfillment.
4. Add the Kazakhstan-eligible local provider only after verifying official merchant onboarding, supported settlement, refund, recurring-payment, and webhook capabilities.
5. Integrate HTTP routes behind feature flags and preserve existing routes.
6. Run unit, integration, webhook replay, duplicate-event, amount-mismatch, currency-mismatch, failure, and refund tests.
7. Open a reviewed PR. Do not merge or enable production without explicit approval and live legal/payment readiness.

## Known repository boundary

The older branch `feat/samurai-commerce-stripe-test` contains a prior Commerce + Stripe test implementation but diverges materially from current `main` (94 commits ahead and 72 behind at audit time). It must not be merged wholesale. Reuse concepts only after independent review and tests.
