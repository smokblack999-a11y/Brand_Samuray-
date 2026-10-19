# Samurai Commerce Order Flow — domain and outbox worker

The commerce domain and a callable outbox worker exist as isolated modules. They are **not yet wired into public HTTP routes, a Telegram commerce conversation, or an automatically scheduled process**.

## Included

- Persistent JSON catalog/order state with atomic file replacement and restrictive file permissions.
- Server-side price calculation; client-supplied prices are not trusted.
- Stock reservation at order creation and restoration when an unpaid order is cancelled.
- Separate delivery and pickup state paths.
- Payment confirmation requires an internal trusted bank/provider/manual-review signal and exact amount matching.
- Idempotency for payment event IDs.
- Courier assignment and an HTTPS delivery-proof reference.
- Corrupt state fails closed rather than silently resetting commerce data.
- Transactional outbox entries are written in the same state persistence operation as order/payment/fulfilment changes.
- Sequential outbox worker with batch bounds, persisted attempts, redacted error text and dead-letter status after a configurable attempt limit.

## Outbox worker contract

Module: `core/commerce-outbox-worker.js`

Create a worker with `createOutboxWorker({ commerce, deliver, maxBatch, maxAttempts, logger })`, then call `await worker.runOnce()` from a trusted server-side scheduler or controlled worker process. The `deliver` callback receives `{ event, order, idempotencyKey }`; the key is the persisted outbox event ID and should be used for deduplication where the downstream system supports it.

The worker is deliberately adapter-agnostic: no Telegram API token, customer/courier chat ID, or payment credential is embedded in the domain module. Delivery failures retry with the same event ID. Once `maxAttempts` is reached, the event moves to `dead_letter` and is excluded from normal processing; operators can inspect it with `commerce.listOutbox({ includeDeadLetter: true })`.

**Delivery semantics are at-least-once, not exactly-once.** If the remote system accepts a message but the process fails before the local delivered marker is persisted, the message may be sent again. Telegram Bot API sends do not provide a general idempotency key for outgoing messages, so a duplicate customer/courier notification remains possible in that failure window. The worker also prevents overlapping `runOnce()` calls only within one worker instance; it is not a distributed lock.

## Not included yet

- HTTP routes and Telegram customer/admin/courier menus, plus a real Telegram delivery adapter.
- Automatically scheduled worker lifecycle, operational endpoint/metrics, and a dead-letter replay/admin workflow.
- Real payment-provider adapter or signature-verified webhook.
- Role-based authorization for staff/couriers.
- Delivery price calculation, order expiry, refunds, and media upload/storage.
- Production database or multi-process locking. JSON persistence is single-process MVP/testing only.

## Payment safety

A screenshot or forwarded receipt is not authoritative proof of funds. `confirmPayment` refuses to mark an order paid unless the caller supplies a trusted verification result. That flag is an internal contract and must never be exposed as a client-controlled HTTP input. A future route must derive it only after verifying a provider webhook/bank API or staff-only manual review.

## State sequence

- Delivery: `pending_payment -> paid -> assigned -> out_for_delivery -> delivered`
- Pickup: `pending_payment -> preparing -> ready_for_pickup -> picked_up`
- Unpaid cancellation releases reserved stock. Paid cancellation is blocked until a refund workflow exists.

Run all core tests from `core/` with `npm test`. CI remains the source of truth for whether the current commit passes.
