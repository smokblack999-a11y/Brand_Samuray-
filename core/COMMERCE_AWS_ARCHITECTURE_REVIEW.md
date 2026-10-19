# AWS Builder review for Samurai Commerce

Reviewed AWS Builder Center guidance on event-driven order processing, async bot pipelines, idempotency, practical AI agents and failure recovery on 2026-10-20.

## Architecture changes: implemented versus remaining

### 1. Transactional outbox — implemented in the single-process MVP

Commerce state changes append outbox events in the same atomic JSON state replacement. Events include OrderPlaced, PaymentConfirmed, CourierDeliveryRequested, CourierAssigned, DeliveryStarted, PickupReady, OrderDelivered, OrderPickedUp and OrderCancelled. The worker processes pending events, preserves event IDs across retries, records bounded error details, and moves repeatedly failing events to dead_letter. A protected API can inspect and explicitly requeue dead-letter events.

This avoids the classic "order saved but event never scheduled" crash gap within the current single-process file-store model. It does not provide a distributed transaction or multi-process safety.

### 2. Idempotency — partly implemented

Provider/bank event IDs are checked for payment confirmation. Repeating the same courier assignment no longer appends another CourierAssigned event. Worker retries preserve the same outbox event ID. However, a crash after Telegram accepts a message and before the local delivered marker is saved can still produce a duplicate message: the Telegram Bot API does not supply a general idempotency key for outgoing messages. Delivery is at-least-once, not exactly-once.

### 3. Separate order acceptance from slow downstream work — implemented for notifications

Product, price, stock, fulfilment type and required delivery/pickup details are validated synchronously. Order plus outbox state is committed before Telegram notification delivery is attempted. The outbox worker is optional and disabled by default; enable it only after configuring bot token, dispatcher chat and allowed courier IDs.

### 4. Bounded retries and dead letters — implemented; production observability remains

The JSON outbox tracks attempts and last error with token-pattern redaction; repeated failures go to dead_letter and require explicit replay. There are not yet metrics/alerts for backlog age, a dedicated operator console, distributed locking, or a managed queue. AWS SQS/EventBridge/Lambda should be introduced only when traffic and deployment requirements justify them.

### 5. Keep AI outside payment authority — enforced in the current flow by separation

AI is not allowed to set prices, claim payment received, assign a courier or confirm fulfilment. The current payment simulation is explicitly test-only, creates no real payment, and is blocked in production configuration. Real payment processing requires signature-verified provider webhooks or a bank API, reconciliation and refund handling before the production state transition can be trusted.

## Implemented flow

Private Telegram customer -> catalog -> checkout -> order + outbox event -> optional notification worker -> Telegram customer/dispatcher/courier.

The checkout supports delivery or pickup, computes totals server-side and stores private-chat conversation state. For test mode outside production, payment can be simulated with a clearly-labelled action; default payment mode is disabled. Dispatcher assignment buttons are shown only for configured courier chat IDs. Only the assigned courier can start and finish delivery through the bot; completion requires a Telegram photo file ID, which is sent to the customer by the outbox adapter.

Internal commerce HTTP endpoints require CORE_API_KEY. They are privileged server/admin endpoints, not safe for client applications. Role-based staff authentication is not yet implemented. JSON state is for MVP/testing only and is unsafe for multiple replicas.

## Measurement and the 22% threshold

No production traffic, benchmark, or baseline from this repository proves a 22% gain today. Treat 22% as an acceptance threshold rather than a claim.

Measure before/after:
- Notification delivery completion rate in a defined time window.
- Lost notifications after simulated crashes.
- Duplicate business effects per 1,000 replayed events.
- p50/p95 time to acknowledge a valid order.
- Mean time to recover failed notifications.
- Cost per completed order.

Scenarios must include process crash after persistence but before send, timeout after Telegram accepts a message, duplicate payment webhook, worker restart, unavailable Telegram API and dead-letter replay. Report sample size and values. Claim >=22% only for a metric that actually improves by at least that amount without regressing payment/order correctness.

## Remaining production blockers

- Real payment provider and signed webhook verification, reconciliation, refunds and order expiry.
- Dedicated role-based dispatcher/courier authentication and audit trail.
- Production database and multi-process-safe queue/locking.
- Operational metrics, dead-letter alerts, retention and real Telegram acceptance tests.
- Delivery fee rules and durable media/photo retention beyond a Telegram file ID.
- Live Telegram Bot API delivery has not been verified in this repository. No AWS resources were deployed or costed.

## Sources reviewed

- AWS Builder Center, “Event-driven architecture on AWS: a beginner's guide” (2026-10-13): https://builder.aws.com/content/3KeRvagv1w1Hs21fc6r2yZ7KfAb/event-driven-architecture-on-aws-a-beginners-guide
- AWS Builder Center, “Building a Practical AI Agent on AWS: From Prompt to Production” (2026-09-29): https://builder.aws.com/content/3Jz5ojIKzMQdrBdlURaTWAvHVBy/building-a-practical-ai-agent-on-aws-from-prompt-to-production
- AWS Builder Center, “Building Idempotent Lambda Functions for Safe Retries” (2026-09-23): https://builder.aws.com/content/3Ji8MhQZ9OWiCrmpnFwUs3hO86Z/building-idempotent-lambda-functions-for-safe-retries
- AWS Builder Center, “Designing Resilient SQS and Lambda Pipelines: Retries, Partial Failures, and Idempotency” (2026-10-10): https://builder.aws.com/content/3KV2wkCAoH1PjjP6g4ywzIWXD73/designing-resilient-sqs-and-lambda-pipelines-retries-partial-failures-and-idempotency
