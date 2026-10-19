# AWS Builder review for Samurai Commerce

Reviewed AWS Builder Center guidance on event-driven order processing, asynchronous bot pipelines, idempotency, practical AI agents, and failure recovery on 2026-10-20.

## Highest-value design changes for Brand_Samuray-

### 1. Transactional outbox before automatic Telegram notifications
Current commerce domain code persists order/payment state but does not yet publish notifications. When the Telegram integration is added, do not save an order and then rely on a best-effort direct send. Store an outbox event in the same durable transaction as the order transition. A worker sends the event and marks it delivered; retries reuse the same event ID. This prevents a process crash between order persistence and notification scheduling from silently losing the notification.

Required event types: OrderPlaced, PaymentConfirmed, CourierAssigned, DeliveryStarted, PickupReady, OrderDelivered, OrderPickedUp, OrderCancelled.

### 2. Idempotency at business-operation level
Payment provider event IDs are not enough for every downstream effect. Give each notification/delivery command a stable event ID and make each consumer safe to process it more than once. Persist delivery attempts and last error. Never retry a payment charge without a stable provider-supported idempotency key and reconciliation path.

### 3. Separate order acceptance from slow downstream work
The customer request should synchronously validate product, price, stock, fulfilment and address/pickup details. After the order is durably accepted, send Telegram notifications, courier assignment messages, media processing, and analytics asynchronously. Report truthful states such as accepted, processing, delivered, or failed; do not say a task completed merely because it was queued.

### 4. Retries, dead-letter handling, and operational visibility
If/when the system uses a managed queue, configure bounded retries, a dead-letter queue, alerting on backlog/age, and partial-batch failure handling. Ensure retry and visibility settings match the actual worker timeout. For the current single-process JSON MVP, implement a durable outbox/retry worker first; do not add AWS infrastructure until the workload and budget justify it.

### 5. Keep the AI assistant outside payment authority
AI can answer catalog questions, summarize orders and help staff triage exceptions. Deterministic server-side rules and verified provider/bank signals must control prices, stock, payment status, courier permissions and fulfilment. Apply least privilege, bounded AI actions, and cost limits.

## Proposed flow

Telegram customer -> Core API -> validate and persist order + outbox event -> outbox worker -> Telegram customer/admin/courier.
Payment provider/bank -> verified webhook -> Core payment validation + durable payment event -> outbox worker -> notify customer and courier workflow.
Courier identity + assigned order -> delivery state transition + proof reference -> outbox worker -> customer receives delivery proof.

## Measurement and the 22% threshold

No measured baseline, production traffic, or benchmark from this repository proves a 22% improvement today. Treat 22% as an acceptance threshold, not a claim.

Before/after benchmark targets:
- Notification delivery completion rate within a defined time window.
- Lost notifications after simulated crashes.
- Duplicate business effects per 1,000 replayed events.
- p50/p95 time to acknowledge a valid order.
- Mean time to recover failed notifications.
- Cost per completed order.

Test cases must include crash after persistence but before send, timeout after Telegram accepts a message, duplicate provider webhook, worker restart, and an unavailable Telegram API. Report measured results and sample size; only claim >=22% when the chosen metric improves by at least that amount without regressing payment/order correctness.

## Current project limitations

- The commerce module is an isolated domain layer and is not yet wired to public HTTP or Telegram routes.
- No production payment provider, signed webhook verification, role-based courier authorization, media upload, delivery fee calculation, refund workflow, or production database is implemented here.
- JSON persistence is single-process MVP/test storage and is not safe for multi-replica use.
- No AWS account/resource deployment or cost estimate has been verified in this repository.

## Sources reviewed

- AWS Builder Center, “Event-driven architecture on AWS: a beginner's guide” (2026-10-13): https://builder.aws.com/content/3KeRvagv1w1Hs21fc6r2yZ7KfAb/event-driven-architecture-on-aws-a-beginners-guide
- AWS Builder Center, “Building a Practical AI Agent on AWS: From Prompt to Production” (2026-09-29): https://builder.aws.com/content/3Jz5ojIKzMQdrBdlURaTWAvHVBy/building-a-practical-ai-agent-on-aws-from-prompt-to-production
- AWS Builder Center, “Building Idempotent Lambda Functions for Safe Retries” (2026-09-23): https://builder.aws.com/content/3Ji8MhQZ9OWiCrmpnFwUs3hO86Z/building-idempotent-lambda-functions-for-safe-retries
- AWS Builder Center, “Designing Resilient SQS and Lambda Pipelines: Retries, Partial Failures, and Idempotency” (2026-10-10): https://builder.aws.com/content/3KV2wkCAoH1PjjP6g4ywzIWXD73/designing-resilient-sqs-and-lambda-pipelines-retries-partial-failures-and-idempotency
