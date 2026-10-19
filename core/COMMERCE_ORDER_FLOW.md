# Samurai Commerce Order Flow — domain and outbox worker

The commerce domain, privileged internal HTTP routes, outbox worker, and Telegram notification adapter are implemented. The server can poll the outbox when explicitly enabled; the default is disabled. A customer-facing Telegram commerce conversation is **not yet wired**, and no real Telegram send or payment-provider integration has been verified.

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

Create a worker with `createOutboxWorker({ commerce, deliver, maxBatch, maxAttempts, logger })`, then call `await worker.runOnce()` from a trusted server-side scheduler or controlled worker process. In `server.js`, polling can be enabled with `COMMERCE_OUTBOX_ENABLED=true`; configure `TELEGRAM_BOT_TOKEN` and `COMMERCE_DISPATCH_CHAT_ID` first. The default is `false` so test/development processes do not send messages unexpectedly. The `deliver` callback receives `{ event, order, idempotencyKey }`; the key is the persisted outbox event ID and should be used for deduplication where the downstream system supports it.

The worker is deliberately adapter-agnostic: no Telegram API token, customer/courier chat ID, or payment credential is embedded in the domain module. Delivery failures retry with the same event ID. Once `maxAttempts` is reached, the event moves to `dead_letter` and is excluded from normal processing; operators can inspect it with `commerce.listOutbox({ includeDeadLetter: true })`. A trusted internal caller can explicitly replay one by calling `commerce.requeueOutboxDeadLetter({ eventId })`; this preserves the event ID, resets the current attempt counter, and records the previous dead-letter attempt count. A privileged API route exposes replay; a role-specific admin workflow is still missing.

**Delivery semantics are at-least-once, not exactly-once.** If the remote system accepts a message but the process fails before the local delivered marker is persisted, the message may be sent again. Telegram Bot API sends do not provide a general idempotency key for outgoing messages, so a duplicate customer/courier notification remains possible in that failure window. The worker also prevents overlapping `runOnce()` calls only within one worker instance; it is not a distributed lock.

## Telegram notification adapter

Module: `core/commerce-telegram-adapter.js`. It uses the existing Telegram Bot API helper and formats the known order events. `OrderPlaced` goes to `order.customerId`; a paid delivery requires `COMMERCE_DISPATCH_CHAT_ID`; `CourierAssigned` sends delivery address/phone only to `order.courierId`, and sends the customer a status-only message. Proof is sent as a URL in text; this does not upload a photo. The dispatcher chat ID is documented in `core/.env.example`.

Before use, verify that customer/courier IDs are reachable private chats for this bot and that courier assignment can only be performed by an authorized operator. The adapter and worker are tested with a fake sender, but the adapter is not started by `server.js` and no real Telegram send has been verified.

## Internal API routes

The following `/api/commerce/...` routes require `X-API-Key: CORE_API_KEY` and are privileged server/admin endpoints: list/create products, create/get orders, assign courier, start delivery, mark pickup ready, confirm fulfilment, cancel unpaid orders, inspect/requeue outbox events, and run the test-payment simulation. Do not expose `CORE_API_KEY` in a mobile app, website JavaScript, or Telegram client. Courier identity is not role-authenticated yet, so these endpoints must remain behind trusted server-side access.

The test-payment endpoint is enabled only when `COMMERCE_PAYMENT_MODE=test` and `NODE_ENV` is not `production`. It creates no real payment and returns `realMoneyMoved: false`. The default `COMMERCE_PAYMENT_MODE=disabled` cannot mark orders paid through that route. Production startup refuses the test payment mode.

## Not included yet

- Customer-facing Telegram catalog/buttons/checkout, and command/callback routing from the existing Telegram webhook into commerce.
- Operational metrics and a dedicated role-based admin/courier authorization flow.
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


## Outbox dispatcher and Telegram delivery adapter

- `commerce-outbox-worker.js` processes pending outbox events sequentially, reuses stable event IDs, stores bounded failure details, and dead-letters after a configurable attempt limit.
- `commerce-telegram-delivery.js` sends one Telegram message per outbox event. `PaymentConfirmed` notifies the customer; the separate `CourierDeliveryRequested` event sends delivery details to the configured courier chat only after server-side payment confirmation.
- Keep the worker and adapter disabled until a dedicated commerce bot token and authorized courier chat ID are configured. Never expose those secrets to client input or logs.
- Delivery is at-least-once, not exactly-once: Telegram may accept a message just before a network timeout. A retry can duplicate that message because Telegram Bot API `sendMessage` has no general idempotency-key parameter. Stable event IDs help internal tracking but do not guarantee Telegram-side deduplication.
- The worker is currently a library module and is not yet scheduled or exposed through the HTTP server. No real Telegram messages have been sent by these tests.
- The JSON store and worker are single-process only. Do not run multiple replicas against the same JSON file; use a transactional database and a queue/lease strategy before scaling.

### Tests added
- Outbox retry/dead-letter handling and secret redaction.
- Separate customer and courier notification events.
- Telegram adapter request routing with mocked HTTP responses; no live Telegram API calls.
