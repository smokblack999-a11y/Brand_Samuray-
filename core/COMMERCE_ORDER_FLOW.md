# Samurai Commerce Order Flow

## Current implementation

The commerce domain, protected internal HTTP API, durable JSON outbox, sequential worker, and Telegram notification adapter are implemented in the branch. The customer-facing Telegram catalog/checkout conversation and live payment provider are not yet integrated. No real Telegram send or real payment has been verified.

Included:
- Catalog products with server-side KZT pricing, stock controls, description and HTTPS media references.
- Order creation with server-computed totals, stock reservation and delivery/pickup paths.
- Trusted-payment guard, exact amount matching and payment event deduplication.
- State transitions that enqueue outbox events in the same persisted operation.
- Bounded retries, stored error details with token-pattern redaction, dead-letter state and explicit replay.
- Optional outbox polling inside `server.js`; it is disabled by default.

## Event flow

Supported outbox events:
`OrderPlaced`, `PaymentConfirmed`, `CourierDeliveryRequested`, `CourierAssigned`, `DeliveryStarted`, `PickupReady`, `OrderDelivered`, `OrderPickedUp`, `OrderCancelled`.

The notification adapter routes `OrderPlaced` and `PaymentConfirmed` to the customer chat; `CourierDeliveryRequested` to `COMMERCE_DISPATCH_CHAT_ID); and `CourierAssigned` to the assigned courier chat, then sends a status-only message to the customer. The courier gets the delivery address and phone; dispatch does not get these fields from the delivery-request notification. Delivery/pickup completion sends a proof URL as text, not an uploaded Telegram photo.

To activate polling, set `COMMERCE_OUTBOX_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, and `COMMERCE_DISPATCH_CHAT_ID`. Defaults in `core/.env.example` keep the worker off to prevent accidental sends. Customer and courier IDs must be reachable chats for this bot. The worker processes events sequentially, with configurable limits `COMMERCE_OUTBOX_INTERVAL_MS`, `COMMERCE_OUTBOX_MAX_BATCH` and `COMMERCE_OUTBOX_MAX_ATTEMPTS`.

**Delivery is at-least-once, not exactly-once.** A network timeout or process crash after Telegram accepts a message but before the delivered marker is saved may cause a duplicate on retry. This worker only prevents overlapping runs within the same instance; JSON persistence is not safe for multiple replicas.

## Protected internal API

All `/api/commerce/...` routes require `X-API-Key: CORE_API_KEY`. Available endpoints include:
- `GET/POST /api/commerce/products`
- `POST /api/commerce/orders` and `GET /api/commerce/orders/:orderId`
- `POST /api/commerce/orders/:orderId/test-payment`
- `POST /api/commerce/orders/:orderId/assign-courier`
- `POST /api/commerce/orders/:orderId/start-delivery`
- `POST /api/commerce/orders/:orderId/ready-for-pickup`
- `POST /api/commerce/orders/:orderId/confirm-fulfilment`
- `POST /api/commerce/orders/:orderId/cancel`
- `GET /api/commerce/outbox` and `POST /api/commerce/outbox/:eventId/requeue`

These are privileged internal/admin routes, not safe browser/mobile-client endpoints. Never put `CORE_API_KEY` in a client app. Courier identity and staff roles are not independently authenticated yet; requests to change fulfilment state must come only from a trusted server/operator until role-based auth is added.

## Test payment mode

Real payment processing is **not implemented**. The test-payment route is available only when `COMMERCE_PAYMENT_MODE=test` and `NODE_ENV` is not `production`; its response explicitly reports `realMoneyMoved: false`. Default mode is `disabled`. Production startup is blocked if test mode is configured. The route uses server-side order amount validation and a unique event ID; it does not contact a bank or payment provider.

A receipt screenshot is not authoritative payment confirmation. `confirmPayment` accepts a trusted signal only as an internal service contract. A real payment route must verify a provider signature/bank API response before calling it.

## Remaining work / production blockers

- Customer-facing Telegram catalog, inline buttons, checkout, callback/message routing and persistent conversation state.
- Signed payment provider integration, reconciliation, refunds and order expiry.
- Telegram courier-role authentication, staff authorization and audit trail.
- Media upload/storage for delivery photos (currently only an HTTPS proof URL is stored).
- Delivery-fee rules.
- Production database and multi-process-safe locking/queueing.
- Operational metrics and tested live delivery.

## State sequence

- Delivery: `pending_payment -> paid -> assigned -> out_for_delivery -> delivered`
- Pickup: `pending_payment -> preparing -> ready_for_pickup -> picked_up`
- Cancelling an unpaid order releases reserved stock. Paid cancellation is blocked until a refund workflow exists.

Run core checks with `cd core && npm test`. CI run status, not the code being present on a branch, is the evidence for a passing test suite.
