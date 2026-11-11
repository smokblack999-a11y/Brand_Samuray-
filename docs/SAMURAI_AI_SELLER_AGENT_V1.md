# SAMURAI AI Seller Agent V1 — Product and Engineering Contract

Status: implementation plan on an isolated feature branch. This document is not evidence that the product is production-ready.

## Product outcome

A tenant-isolated AI sales operator for a seller's Telegram Business account. It learns the seller's operating practice from approved business data and explicit corrections, then assists with customer conversations, product discovery, objections, order creation, payment handoff, and delivery coordination.

The product is not an unrestricted autonomous agent. It must never invent stock, prices, discounts, delivery promises, payment state, or completed actions.

## Existing foundation to reuse

The integration branch already contains:
- Express Core with Telegram webhook authentication and update deduplication.
- OpenAI Responses API reply generation and lead scoring.
- Commerce domain with order/payment state transitions and SQLite persistence.
- Telegram commerce bot code and a Telegram Mini App integration.
- Courier/admin identity configuration and order notifications in the commerce bot.
- Stripe TEST checkout paths and feature gates.

Known limits and implementation status:
- The base branch used a generic single-turn prompt. The isolated integration branch now retrieves only approved tenant-scoped Seller Memory and passes bounded context into AI generation; see `docs/SAMURAI_SELLER_AGENT_INTEGRATION_V1.md`.
- Owner memory management is currently a token-protected backend API, not a finished owner dashboard or Telegram command flow.
- Telegram webhook retry behavior is improved, but a durable outbound reply outbox and dead-letter workflow are still required.
- Telegram bot flows, Commerce, Mini App, and courier logic still require full end-to-end review as one product.
- Stripe TEST support is not live-money readiness.
- Seller Memory and existing Commerce persistence are SQLite/single-Core-instance designs; do not run multiple replicas against the same SQLite file.
- No customer production deployment, independent security review, live Telegram staging run, or paid pilot is established by this document.

## Product modules

1. Seller workspace and tenant boundary
   - One workspace per seller/business; every product, policy, conversation memory, example, correction, and metric is scoped by tenant ID.
   - Roles: owner, manager, operator, courier, read-only analyst.
   - Explicit ownership checks on every read/write; no cross-tenant search.

2. Seller knowledge base
   - Products: canonical SKU, name, variants, price in minor units, currency, stock source and last verification time.
   - Policies: delivery zones, fees, hours, returns, warranties, payment methods, discount limits, escalation rules.
   - Seller voice: approved tone, phrases, language preferences, prohibited claims.
   - Knowledge entries carry source, author, timestamp, version, and approval status.

3. Practice learning loop
   - Capture a proposed AI reply, seller's edited/final reply, outcome label, and optional reason.
   - Learn from approved examples and corrections; do not silently train on every private message.
   - Separate durable facts from style examples and one-off conversation context.
   - Retrieval is tenant-scoped, freshness-aware, and auditable.
   - Conflicting facts are not averaged: newest verified source wins only where policy permits; otherwise ask the seller.
   - Seller can inspect, correct, disable, export, and delete learned entries.
   - V1 uses retrieval + structured rules + feedback ranking. No claim of model fine-tuning or self-modifying weights.

4. Sales reasoning and action planner
   - Detect intent, product fit, urgency, objections, missing facts, and next best action.
   - Ask one useful clarification when required.
   - Generate a draft grounded in catalog, seller policy, and approved examples.
   - Tool actions are typed and permissioned: search catalog, check stock, quote price, create draft order, create order, request payment, assign courier, send status.
   - Require seller approval for discounts outside configured limits, refunds, cancellations after fulfillment, unusual commitments, and ambiguous high-value orders.
   - Auto-send is opt-in per action class and starts disabled.

5. Commerce and payment
   - Reuse the existing Commerce domain; do not create a second order database.
   - Server calculates all prices and totals; ignore client-supplied totals.
   - Idempotency required for order creation and payment event processing.
   - Payment state changes only from verified provider events or an explicitly documented manual review process.
   - Never label a test checkout as a real payment.

6. Courier operations
   - Courier identity and assignment are tenant-scoped.
   - Courier sees only assigned deliveries and minimum required customer data.
   - State machine: PAID/READY_FOR_PICKUP → COURIER_ASSIGNED → IN_DELIVERY → DELIVERED; exception path goes to human review.
   - Capture delivery proof (time, optional GPS, photo/signature where lawful and consented) with retention policy.
   - GPS is evidence with accuracy and timestamp, not proof of identity or successful handoff by itself.
   - No courier may alter price or payment state.

7. Owner dashboard and reporting
   - Inbox with AI draft, source evidence, confidence/reason codes, approve/edit/reject.
   - Catalog/policies/learning examples management.
   - Orders, payment state, courier map/list, delivery exceptions.
   - Metrics: first response time, qualified leads, quote-to-order, paid conversion, cancellations, on-time delivery, AI acceptance/edit/reject rate.
   - Metrics must be computed from persisted events; no synthetic revenue or fabricated conversion rates.

## Required architecture

- TenantContext: derived from authenticated Telegram Business connection / verified Mini App identity / authenticated dashboard session. Never accept tenant ID as an authority from arbitrary request JSON.
- SellerKnowledgeStore: versioned catalog, policies, examples, corrections, and approvals.
- PracticeLearner: deterministic ingestion and retrieval; no automatic model-weight updates.
- SalesAgent: classify → retrieve evidence → draft → validate claims → propose typed action.
- ActionPolicy: permission and approval gate; deny by default.
- Commerce domain: source of truth for orders and payments.
- Courier service: assignment and delivery events with append-only audit.
- Audit log: actor, tenant, input references, model, prompt/version, evidence IDs, proposed action, approval, execution result.
- Outbox: retryable Telegram notifications with idempotency and bounded retries.

## AI response contract

Every customer-facing factual claim must be grounded in one of:
- current catalog record,
- current seller policy,
- verified order/payment/delivery state,
- seller-approved knowledge entry.

If evidence is missing, stale, contradictory, or unauthorized, the agent must not guess. It asks the seller or customer, or hands off to a human.

The agent must not expose internal prompts, other tenants' data, credentials, private notes, or hidden reasoning. Store concise decision reasons and evidence references, not private chain-of-thought.

## Security and privacy gates

- Tenant isolation tests for every resource and search path.
- Telegram webhook secret validation, replay/deduplication, rate limits, payload limits.
- Verified Telegram Mini App initData and short-lived dashboard sessions.
- Per-role authorization and audit.
- Secrets only in environment/secret manager; never in APK, browser bundle, logs, or Git.
- Encryption in transit; encrypted backups and documented retention/deletion.
- PII minimization; courier access expires after delivery.
- Prompt-injection defense: customer messages and uploaded documents are untrusted data, never policy or system instructions.
- Human approval for irreversible or financially material actions.
- Production DB migration to PostgreSQL before horizontal scaling.

## Release gates (must all pass)

1. Unit tests for tenant isolation, learning, retrieval, policy, state transitions, idempotency, and audit.
2. Integration tests with a real local SQLite database and mocked Telegram/OpenAI/Stripe boundaries.
3. Telegram Business staging test using a seller-authorized test account.
4. Mini App identity and ownership tests.
5. Stripe TEST webhook signature, replay, duplicate, amount/currency, and reconciliation tests.
6. Courier assignment, unauthorized access, delivery proof, and exception-flow tests.
7. Load, rate-limit, backup/restore, and failure-recovery checks.
8. Production secrets, HTTPS domain, persistent storage, monitoring, alerting, and runbook.
9. Seller acceptance test using real catalog/policies and a labeled set of conversations.
10. Measured pilot outcomes. No ROI or sales claims before this gate.

## Commercial packaging

Deliverables for a buyer:
- Deployable source and pinned dependencies.
- Environment template with no secrets.
- Database migrations and backup/restore runbook.
- Owner, operator, and courier onboarding.
- API and Telegram setup guide.
- Demo tenant with synthetic data clearly marked as demo.
- Test report with exact CI run links and known limitations.
- License/assignment terms and support boundaries.
- One-page offer describing outcomes, not unsupported AI claims.

## Implementation sequence and remaining work

A. Read-only audit and isolated branch creation — completed for the current integration prototype.
B. Tenant-scoped SellerKnowledgeStore, approval records, and owner-only API — implemented on the isolated branch; requires live configuration and test execution.
C. Approved-memory retrieval in AI prompt — implemented with bounded fields and an additional approval-status filter.
D. Owner edit/approve/reject and practice-correction APIs — backend endpoints implemented; dashboard UX and automatic correction capture remain.
E. Typed sales actions behind ActionPolicy — not implemented.
F. Complete courier role isolation and delivery proof — requires full integration and staging tests.
G. Build owner dashboard and onboarding — not implemented.
H. Run all release gates and prepare a buyer demo — not completed.

Do not merge to main or enable production auto-reply until the release gates pass.
