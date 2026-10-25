# SAMURAI Commerce — architecture audit and next implementation plan

Review date: 2026-10-26. Scope: Telegram customer orders, payments, courier workflow, Android camera/GPS, multi-country currencies, and OpenAI DevDay features relevant to this product.

## 1. Evidence boundary

- Reviewed repository branch: `feat/samurai-commerce-orders-v1`, head at review start `38b53b6d4f31e7cc78a818428858f2ff5243da1e`.
- Pull request: #113, open and draft, targeting `feat/x10thinc-hamylion-v3`. It is not merged into the base branch.
- GitHub Actions run `40223883249` (Core X22 CI) completed successfully at the reviewed head. The PR metadata records Core CI and Android Debug APK build as successful at that head; these are build/CI results, not a deployed end-to-end proof.
- The link supplied by the user ends in `/13`. That forum reply is a joke about the naming of ChatGPT Spaces, not a technical implementation guide. The parent DevDay topic is an announcement summary; use official OpenAI API documentation for implementation decisions.
- This review reads repository files and CI metadata. It does not claim that a production server, Telegram webhook, Stripe account, crypto node, or physical phone was contacted.

## 2. What is already present in the branch

### Telegram commerce

- Private-chat customer flow: `/start`, catalog, quantity selection, pickup/delivery, delivery zone/address, order creation, `/myorders`, `/pay ORDER_ID`, and receipt submission.
- Product prices and delivery fees are server-configured. Order records bind the customer to a numeric Telegram user ID.
- A Stripe TEST Checkout adapter creates a hosted test payment link. The webhook validates Stripe's signature, rejects live-mode events, checks paid status, order/session reference, amount and currency, and handles duplicate events.
- Expired/uncertain Checkout sessions are reconciled against Stripe before another payable link is issued.
- Receipt screenshots/photos are stored as review evidence and move the order to `PAYMENT_REVIEW`; a receipt alone does not set `PAID`.
- Manual bank reconciliation is an explicit, audited operator attestation, disabled by default and blocked in production. It is not automatic bank verification.
- Courier assignment is blocked before verified payment. Telegram courier commands and a separate authenticated Android upload endpoint exist.
- Photo upload checks the courier token and order assignment, requires paid status, validates MIME plus image signatures, enforces a 10 MiB cap and per-order in-process serialization, records SHA-256 and optional GPS/time metadata, and sends the stored photo to the customer ID on that order.
- The Android app includes CameraX, local gallery, optional location permissions, a Core URL build setting, and a courier upload screen. APK CI proves packaging, not device permissions, server connectivity, or successful delivery on a real phone.

## 3. Highest-priority engineering gaps

### P0 — before any public pilot with real customer data

1. **Storage and atomicity.** Orders, event IDs, Telegram update IDs, sessions and notification state are file-backed JSON. Atomic rename reduces partial-file risk but does not provide transactions, row-level locking, uniqueness constraints across processes, or a durable outbox. Concurrent replicas can lose updates or double-handle work. Before public operation, move order/payment/audit/notification state to PostgreSQL (or another transactional DB) and use database uniqueness plus transactions.
2. **Single state-transition service.** Centralize all order/payment transitions and enforce allowed source→destination states, actor authorization, expected version, and audit event in one transaction. Reject payment for cancelled/refunded/expired orders unless a deliberate reconciliation path handles it. Provider callbacks and retries must be idempotent by both provider event ID and provider transaction/payment ID.
3. **Payment-attempt ledger.** A single order-level Checkout session is not a scalable multi-provider contract. Add one payment-attempt record per attempt, with immutable order ID, expected amount, currency, merchant/provider account, environment, provider reference, event IDs, verified timestamp and normalized status. A second successful attempt must create a reconciliation incident, not overwrite the first.
4. **Durable notification outbox.** The current retry logic is single-instance and file-backed. Persist notification jobs transactionally with the state change; deliver asynchronously with bounded exponential backoff, per-recipient delivery state, idempotency keys, and a dead-letter/manual-retry view.
5. **HTTPS deployment and secrets.** No public HTTPS deployment or real Telegram/Stripe webhook end-to-end test is evidenced. Configure TLS at the reverse proxy/host, exact Telegram webhook secret, Stripe TEST endpoint/signing secret, persistent volume/database, backups, health/readiness, log redaction and rotation. Never put credentials in Git, APK resources, URLs, chat messages or logs.
6. **Physical-device acceptance.** The APK's documented default URL is emulator-only (`10.0.2.2:8787`). A real phone needs a new build with the deployed HTTPS Core URL. Test camera denial, location denial, GPS unavailable, upload interruption, duplicate upload, customer blocked bot, and correct customer/photo pairing on the actual target phone.

### P1 — before multi-country or additional payment methods

7. **Currency model is KZT-specific.** Current catalog and orders use `priceKzt`, `unitPriceKzt`, `itemsTotalKzt`, `deliveryFeeKzt`, and `totalKzt`; Stripe adapter expects KZT and validates amount in 1/100 KZT minor units. Changing `COMMERCE_CURRENCY` alone does not implement another currency. Add an explicit money object `{ amountMinor, currency, minorUnitScale }` and country/provider configuration. Keep a compatibility migration for historical KZT orders; do not rewrite historical totals.
8. **Country and merchant eligibility.** Country of the buyer is not the same as merchant establishment, settlement country or fulfilment country. Each market needs an explicit approved tuple: legal merchant entity/country, buyer markets, display and settlement currency, currency scale, provider/account, refunds/chargebacks, taxes/consumer rules, delivery zones and data/privacy requirements. Unknown tuples must fail closed.
9. **Bank API is absent.** The current `/confirmbank` workflow is human attestation after an operator independently checks settled funds. Before claiming automated verification, integrate an authenticated bank/acquirer API or provider webhook, validate account/beneficiary, amount, currency, transaction reference, settled status and uniqueness. A receipt image or SMS is not authoritative.
10. **USDT/BTC are not implemented.** No customer-facing crypto payment address or mainnet flow should be enabled. First choose one exact USDT chain and token contract, plus a trusted BTC testnet node/indexer; define unique deposit correlation, quote expiry, confirmation thresholds, under/overpayment policy, reorg handling, duplicate tx hash handling, refunds, custody and legal approval. Mainnet stays disabled until a separate reviewed release gate.
11. **Privacy and location.** GPS can expose a customer's or courier's sensitive location. Collect only with clear consent and for a stated order purpose; store accuracy and capture time, limit access/retention, and avoid putting exact coordinates into general application logs. GPS supplied by the phone is useful evidence but can be spoofed; do not describe it as cryptographic proof of physical presence.

### P2 — reliability and operations

12. Add structured audit events for every transition: actor ID/role, old/new status, reason code, provider reference, request/event ID and timestamp. Never log full card data, payment secrets, bot tokens, full addresses unnecessarily, or wallet secrets.
13. Add admin visibility for failed webhook deliveries, duplicate-payment incidents, missing courier, notification failures, photo delivery pending, old `PAYMENT_REVIEW` items and stale orders.
14. Add backup/restore drills and migration rollback. Pin dependencies, run dependency and secret scanning, and test recovery from process termination between provider confirmation and persistence/notification.
15. Keep the Core API and courier upload credentials separate. Store only hashed courier tokens if the deployment contract permits a safe token-hash verification design; rotate/revoke per courier. Avoid broad admin API keys in the Android client.

## 4. Recommended architecture

Telegram Bot / Android app → HTTPS Core API → domain services → PostgreSQL transaction + outbox → provider adapters / Telegram delivery worker.

Core domain modules:
- `CatalogService`: country-aware catalog and server-calculated prices.
- `OrderService`: immutable order snapshot, fulfillment, address/zone, state machine and authorization.
- `PaymentAttemptService`: one record per attempt; no direct state changes from UI or AI.
- `PaymentProvider` adapters: Stripe test, then eligible local acquirer/bank, then independently verified crypto testnet adapters.
- `CourierService`: atomic assignment claim, role checks, paid-only dispatch, photo proof and exact customer recipient resolution.
- `OutboxWorker`: Telegram messages/photo delivery with retries and durable per-recipient status.
- `AuditLog`: append-only domain audit events, with redaction and retention rules.

Do not let Android, Telegram callback data, uploaded receipt metadata, or a model response set price, `PAID`, recipient Telegram ID, courier assignment, wallet address or delivered status.

## 5. OpenAI DevDay features — where they help and where they must not be used

- **Function calling / Structured Outputs:** useful for grounded catalog Q&A, extracting a customer's intent into a proposed product/quantity/address form, or extracting candidate fields from a receipt for an admin review screen. The server must validate every field against catalog and authenticated identity. Strict schema improves shape; it does not prove facts, authorization or payment.
- **Agents SDK / Agents API:** not needed for the first safe commerce release. Consider later for customer support or internal admin assistance, with read-only tools first, explicit role checks, traceability, rate limits, evaluations and human approval for high-impact actions.
- **Decisions API:** the DevDay recap describes it as a limited preview for constrained classification/routing. Do not put the payment ledger, provider selection, fraud decision, wallet destination or release gate behind a preview API.
- **OpenAI webhooks:** these are events emitted by OpenAI services. They are not Stripe webhooks and cannot verify money received. Keep separate endpoints, signing secrets, event deduplication and retry policies for each provider.
- **Codex code review/security scanning:** use as an additional reviewer for diffs and vulnerabilities. It is not a replacement for deterministic tests, dependency scans, a human review of payment state transitions, or a deployed test transaction.
- **API data controls:** before sending any data to a model, minimize it. Do not send receipt images with card/account details, full delivery addresses, private keys, seed phrases or payment secrets. Prefer masked candidate fields and keep `store`/retention settings explicit for the selected endpoint and organization policy.
- **Do not add multi-agent complexity to move orders.** Payments and dispatch should be deterministic state machines. AI is an optional interface/extraction layer, never the authority.

Official sources:
- DevDay recap: https://openai.com/index/devday-2026-recap/
- DevDay sessions: https://openai.com/devday/2026/
- Function calling: https://developers.openai.com/api/docs/guides/function-calling
- Agents overview: https://developers.openai.com/api/docs/guides/agents
- Agents SDK: https://developers.openai.com/api/docs/guides/agents/sdk
- OpenAI webhooks: https://developers.openai.com/api/docs/guides/webhooks
- API data controls: https://developers.openai.com/api/docs/guides/your-data
- Telegram Bot API (webhook secret, update IDs, sendPhoto/sendLocation): https://core.telegram.org/bots/api

## 6. Implementation order — do not skip gates

### Slice A: transactional foundation
1. Define the domain state machine and a versioned migration from JSON to PostgreSQL.
2. Create tables for orders, order items/snapshots, payment attempts, provider events, payment receipts, courier proof, audit events, and outbox jobs.
3. Add uniqueness constraints for provider+event ID, provider+transaction ID, idempotency key, and one active courier assignment per order.
4. Implement transactional outbox and restart/replay tests.

### Slice B: multi-currency without enabling new providers
5. Add `Money` and `CountryPaymentConfig` types; define currency minor-unit scale explicitly and validate against a vetted currency table.
6. Migrate existing KZT fields into the new canonical money fields while preserving legacy read compatibility.
7. Keep Stripe TEST adapter KZT-only until its amount conversion and regression suite are updated. Do not silently interpret a KZT integer as another currency.
8. Add tests for zero-/two-/three-decimal currencies, overflow, invalid currency, mismatched provider currency, rounding and immutable order totals.

### Slice C: payment provider contract
9. Introduce provider interface for create attempt, verify callback, query status, normalize status and (only if supported) refund.
10. Add negative tests for wrong signature, live-mode event, wrong order/session, amount/currency mismatch, replayed event/transaction, provider timeout and persistence failure.
11. Choose a local bank/acquirer only after merchant eligibility and official API/webhook/status-query documentation are confirmed.
12. Keep crypto adapter tests on testnet only; no mainnet credentials or addresses in this phase.

### Slice D: full end-to-end pilot
13. Deploy staging Core with HTTPS and persistent database; configure Telegram webhook and provider TEST webhook.
14. Build APK with staging HTTPS URL and test on physical Android.
15. Run a complete order matrix: pickup, delivery, fake receipt, valid test payment, duplicate event, duplicate successful session, courier assignment, GPS photo, customer blocked bot, notification retry, server restart, unauthorized user and wrong order ID.
16. Save test evidence (commit SHA, CI run, test transaction IDs in test environment, redacted logs, screenshots) and keep the PR draft until every acceptance criterion passes.

## 7. Release decision

Current decision: **continue in test/staging only**. The branch contains a meaningful Telegram order/courier prototype and passing CI, but it is not a production-ready multi-country commerce system. Do not merge the draft PR to the base branch or enable live payments based only on CI. The next high-value engineering slice is the transactional database + payment-attempt/outbox foundation, followed by the currency abstraction; not adding more AI agents.