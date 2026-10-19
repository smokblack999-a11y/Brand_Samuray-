# Samurai Commerce Order Flow

## Current implementation

The branch contains the commerce domain, protected internal HTTP API, persistent private-chat checkout, Telegram callback/message handler, Telegram notification adapter, and an optional durable outbox worker. Core behavior is covered with tests and GitHub Actions; live Telegram delivery has not been verified against a real bot account, and real payment processing is not implemented.

### Customer Telegram flow

The regular Telegram bot handles private chats:
- /start or /menu opens the menu.
- /catalog shows paginated products. Product detail can send the first configured HTTPS photo/video.
- Customer chooses quantity, then delivery or pickup.
- Delivery asks for address; pickup asks for pickup point. The bot then asks for a contact phone number or accepts "-" to skip. A contact is accepted only when it belongs to the same Telegram user.
- Customer receives a server-computed KZT total and order ID.
- In COMMERCE_PAYMENT_MODE=test outside production, a clearly-labelled simulation button can mark payment as test-confirmed and does not move real money. Otherwise, the bot warns that no payment method is connected and the customer must not transfer money.
- /orders lists only that customer's order summaries. Unpaid pending orders can be cancelled.
- After test-confirmed delivery payment, dispatch receives a courier assignment keyboard if courier IDs are configured. The assigned courier receives address/phone, starts delivery, and submits a Telegram photo. The customer is sent the photo via outbox after the event worker processes the order.
- Pickup can be marked ready by the trusted internal API; the customer confirms pickup with a button.

## Outbox and notifications

Outbox events are persisted in the same state replacement as order and payment transitions. Supported events: OrderPlaced, PaymentConfirmed, CourierDeliveryRequested, CourierAssigned, DeliveryStarted, PickupReady, OrderDelivered, OrderPickedUp, and OrderCancelled.

The worker in core/commerce-outbox-worker.js polls sequentially when COMMERCE_OUTBOX_ENABLED=true. Configure TELEGRAM_BOT_TOKEN, COMMERCE_DISPATCH_CHAT_ID, and allowed private courier IDs in COMMERCE_COURIER_CHAT_IDS first. Defaults in core/.env.example keep the worker disabled. The webhook setup script subscribes to message and callback_query alongside Telegram Business updates.

Retries preserve the event ID and are bounded by COMMERCE_OUTBOX_MAX_ATTEMPTS; terminal failures become dead_letter. A privileged internal API can inspect and explicitly requeue dead-letter events. Telegram Bot API does not offer a general idempotency key for outgoing messages, so the worker is at-least-once, not exactly-once: a crash or timeout after Telegram accepts a message may cause the same notification to be sent again. The worker only prevents overlapping calls within one process instance. JSON storage is not safe for multiple replicas.

## Protected internal API

All /api/commerce/... routes require X-API-Key: CORE_API_KEY. Available endpoints:
- GET/POST /api/commerce/products
- POST /api/commerce/orders and GET /api/commerce/orders/:orderId
- POST /api/commerce/orders/:orderId/test-payment
- POST /api/commerce/orders/:orderId/assign-courier
- POST /api/commerce/orders/:orderId/start-delivery
- POST /api/commerce/orders/:orderId/ready-for-pickup
- POST /api/commerce/orders/:orderId/confirm-fulfilment
- POST /api/commerce/orders/:orderId/cancel
- GET /api/commerce/outbox and POST /api/commerce/outbox/:eventId/requeue

These are privileged internal/admin endpoints, not safe browser/mobile-client endpoints. Never put CORE_API_KEY in a client application. Courier/staff roles are not independently authenticated; fulfilment/admin routes must be used only by a trusted server/operator until role-based auth and an audit trail are added.

## Payment and deployment limitations

Real payment processing is not implemented. The test-payment route is enabled only when COMMERCE_PAYMENT_MODE=test and NODE_ENV is not production; its response states realMoneyMoved: false. Default mode is disabled, and production startup is blocked if test mode is configured. The route does not contact a bank or payment provider.

A receipt screenshot is not authoritative proof of funds. The commerce service trusted payment flag is an internal service contract and must never be accepted from public client input. Real payments require signature-verified provider webhooks or a bank API, reconciliation, and a refund workflow.

Delivery currently stores a Telegram photo file_id or HTTPS proof URL; the adapter re-sends the Telegram photo to the customer when a file ID is available. This is not an independent object-storage/archive solution and should be evaluated for long-term evidence retention.

Other production blockers:
- Real signed payment-provider adapter, reconciliation, refunds and order expiry.
- Staff/courier role authentication, protected operator accounts and audit trail.
- Delivery-fee rules.
- Production database and multi-process-safe locking/queueing.
- Operational metrics, dead-letter alerts and real Telegram acceptance tests.
- No benchmark has proven a 22% improvement. Establish a baseline and compare lost notifications, duplicates, order latency, recovery time, and cost per completed order.

## State sequence

- Delivery: pending_payment -> paid -> assigned -> out_for_delivery -> delivered
- Pickup: pending_payment -> preparing -> ready_for_pickup -> picked_up
- Cancelling an unpaid order releases reserved stock. Paid cancellation is blocked until a refund workflow exists.

Run core checks with cd core && npm test. CI results for the latest commit, not code presence alone, are the evidence of a passing test suite.
