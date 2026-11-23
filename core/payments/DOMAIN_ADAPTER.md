# SAMURAI Payments Domain Adapter Contract

This contract is the boundary between the payment subsystem and the real SAMURAI commerce/account domain. It is intentionally not implemented with fake data.

A module selected by `PAYMENTS_DOMAIN_ADAPTER_MODULE` must export these five async functions:

```js
module.exports = {
  async resolveDeliveryOrder(orderId, request) {},
  async resolveSaasPlan(planId, request) {},
  async onDeliveryPaid(paymentRecord, checkoutSession) {},
  async onDeliveryFailed(paymentRecord, checkoutSession) {},
  async onSubscriptionStatusChange(subscriptionRecord, stripeEvent) {}
};
```

## Resolver invariants

### `resolveDeliveryOrder(orderId, request)`

Must load the authoritative order from the real order store and verify that the authenticated caller owns it. Return only a currently payable order:

```js
{
  orderId: "internal-order-id",
  payable: true,
  customerId: "internal-customer-id",
  productName: "human-readable item name",
  amountMinor: 250000,
  currency: "KZT",
  version: 4
}
```

- Return `null` or `payable: false` for missing, already-paid, canceled, expired, or unauthorized orders.
- Never accept amount, currency, customer ID, or order state from request body.
- `version` must change when an order is edited or a new payment attempt is intentionally permitted.
- The current payment router treats this resolver as the only source of payment amount and customer identity.

### `resolveSaasPlan(planId, request)`

Must authenticate and resolve the caller's SAMURAI customer identity, check that the plan is available, and map the internal plan ID to a Stripe Price ID configured on the server. Return:

```js
{
  planId: "pro",
  customerId: "internal-customer-id",
  priceId: "price_server_configured_id",
  version: 2
}
```

Do not accept a Stripe Price ID or subscription amount from the client.

## Side-effect callback invariants

### `onDeliveryPaid(paymentRecord, checkoutSession)`

Must be idempotent by internal order ID/payment ID. In one transaction in the actual order store, transition only a payable order to paid and enqueue fulfillment. If already paid by this payment, return success without creating a second fulfillment task. If paid by another payment, raise a conflict for manual reconciliation.

### `onDeliveryFailed(paymentRecord, checkoutSession)`

Must update only the matching payment attempt. It must not cancel or overwrite an order that has since been paid by another valid attempt.

### `onSubscriptionStatusChange(subscriptionRecord, stripeEvent)`

Must map the internal customer and plan to entitlements and apply the canonical subscription status idempotently. Do not grant access based on a browser redirect. Define access policy for `past_due`, `unpaid`, `paused`, and `canceled` explicitly.

## Activation

The Core server mounts payment routes only when all are true:

- `PAYMENTS_HTTP_ENABLED=true`
- `PAYMENTS_ENABLED=true`
- `PAYMENTS_MODE=test`
- `PAYMENTS_PROVIDER=stripe_test`
- The configured adapter module exports all five functions above.
- Stripe test secret and webhook signing secret are present.

The server refuses startup if the adapter is missing or incomplete. No routes are mounted by default.

## Current repository limitation

The current `core/store.js` persists leads only. It does not define Delivery orders, customer ownership, SaaS plans, or entitlement records. Until those domain stores and their ownership rules exist, a production-safe concrete adapter cannot be implemented without inventing business data or weakening authorization.
