# HYBRID AgentMail + LUX/ONI + NocoBase Integration V1

Status: architecture contract / integration scaffold only. No credentials, external accounts, runtime routes, deployments, or production data are connected by this document.

Base: `feat/x10thinc-hamylion-v3` at `e7a1756d09b8a1392dd05a3b320cafeb8adeaf8b`.
This branch is intentionally isolated: `feat/hybrid-agentmail-lux-bridge-v1`.

## 1. Ownership boundaries

- **SAMURAI Core** remains the policy/control plane and source of truth for tenant identity, authorization, event state, approval, and outbound actions.
- **LUX / ONI Analyst** is a separate analysis worker/service. It receives only minimized, tenant-scoped, approved-to-process inputs. It cannot send email, change CRM records, trigger payments, or execute arbitrary tools.
- **AgentMail** is the email transport and event source. Its message body and attachments are untrusted input.
- **NocoBase** is the CRM/admin presentation and workflow surface. It accesses SAMURAI through authenticated, allowlisted HTTP APIs. It must not connect directly to Core's private store or share Core credentials with browser clients.

## 2. Inbound event pipeline

`AgentMail webhook -> HTTPS ingress -> raw-body signature verification -> schema/size validation -> event_id dedupe -> durable event ledger -> fast 2xx acknowledgement -> worker -> tenant/inbox mapping -> message fetch -> policy classification -> LUX analysis -> Kill Critic -> owner approval -> optional draft/send`

Rules:

1. Verify AgentMail's Svix signature against the exact raw request body before parsing JSON. Mount the webhook raw-body handler before the global JSON parser, or retain the raw bytes in an Express verify hook.
2. Deduplicate on AgentMail `event_id`, not `svix-id`. Delivery is at-least-once and events may arrive out of order.
3. Persist the event before returning 2xx. Do not run LLM analysis inside the webhook request.
4. Acknowledge only after durable acceptance; worker processing is asynchronous, retryable, and idempotent.
5. Maintain a reconciliation job using AgentMail's event/message listing APIs because endpoints may be disabled after sustained delivery failures and missed events are not automatically replayed.
6. Check message labels/status before analysis. Messages marked `agent-armor-held` are quarantined and must not enter the AI pipeline unless an explicit owner policy allows a safe review path.
7. Treat email body, HTML, attachments, quoted text, and external links as untrusted data. They cannot override system/developer instructions or authorize tool calls.

## 3. Service-to-service contract

Initial internal contract (versioned; implementation pending):

- `POST /internal/v1/analysis/email`: Core worker submits a minimized message envelope to LUX.
- Required envelope: `eventId`, `tenantId`, `inboxId`, `messageId`, `receivedAt`, `classification`, `contentDigest`, `text` (bounded), `attachments[]` (metadata only by default).
- LUX response: `analysisId`, `summary`, `intent`, `riskFlags[]`, `evidence[]`, `confidence`, `recommendedAction`, `requiresHumanApproval: true`.
- LUX must not return an executable command or an instruction to send. Core validates the response schema and independently runs Kill Critic.
- Authentication: dedicated service identity and rotated secret; never reuse `CORE_API_KEY`, Telegram secrets, AgentMail signing secret, or NocoBase user tokens.
- Network: private service-to-service route where possible; TLS in transit; strict request size/time limits; no public LUX listener unless protected by an authenticated gateway.

## 4. NocoBase integration

- NocoBase calls Core's narrow REST endpoints; it does not query Core's database.
- Start read-only: inbox events, analysis summaries, risk flags, evidence references, approval queue, health.
- Mutations require owner/admin authorization at Core, tenant scoping from server-side identity, audit logging, and explicit allowlists.
- Do not expose secrets or raw email bodies in client-side variables, URLs, logs, or dashboard source.
- Do not assume the REST API data-source plugin is included in every NocoBase edition; confirm the deployed edition and plugin entitlement before configuration.
- NocoBase remains replaceable. Business rules and authorization stay in Core.

## 5. Persistence and reliability

- Do not use the current JSON lead store as the durable cross-process event ledger.
- Prefer the existing HAMYLION durable queue/journal path only after its exact implementation and tests are verified on the selected base commit. Otherwise add an isolated PostgreSQL event ledger and worker in this branch.
- Required event states: `accepted`, `processing`, `completed`, `retryable_failed`, `dead_letter`, `quarantined`.
- Unique constraint: `(provider, event_id)`. Store payload digest and minimal metadata; encrypt or avoid storing raw email content.
- Enforce bounded retries, lease expiry/reclaim, dead-letter inspection, replay authorization, retention, and audit records.
- Ordering: use provider event timestamps and per-message sequence/version where available; do not assume webhook arrival order.

## 6. Safety and approval

- Initial mode is read-only analysis + draft recommendation. Automatic outbound email is disabled.
- No automatic payment, refund, account changes, CRM destructive writes, or customer targeting.
- Human approval is required before any external side effect.
- Public OSINT and blockchain analysis, if later added, is limited to public organizational/project data and transaction-risk analysis. No deanonymization, private-person vulnerability profiling, or social-engineering generation.
- Redact secrets, authentication headers, message bodies, and attachment contents from logs.

## 7. Acceptance gates

1. Unit tests: signature valid/invalid, stale timestamp, malformed payload, size limit, duplicate event, out-of-order event.
2. Integration tests: durable acceptance before 2xx, worker retry/reclaim, DLQ, replay, tenant isolation, cross-tenant denial.
3. Prompt-injection tests: email body/attachment content cannot alter policy or invoke tools.
4. Kill Critic tests: unsupported claims, missing evidence, unsafe action, and unapproved send are blocked.
5. NocoBase tests: read-only views, tenant isolation, role matrix, no secret leakage, server-side mutation authorization.
6. Staging E2E with a dedicated test inbox and synthetic data; verify event reconciliation after webhook downtime.
7. Production gate: owner approval, dedicated secrets, TLS, backups, monitoring, retention policy, security review, and rollback plan.

## 8. Known current-state gaps (from source inspection)

- The selected Core branch's `server.js` installs `express.json()` globally before feature routes. A Svix receiver must preserve raw bytes before JSON parsing.
- The selected branch's `store.js` uses a local JSON file. It is not a suitable distributed idempotency ledger for multiple workers/instances.
- EVOLUTION V3 has a separate PostgreSQL adapter and tenant membership checks on another Draft branch; it is not automatically part of this selected Core base.
- The X10THINC/HAMYLION PR description claims PostgreSQL journal, Redis Streams, idempotency, reclaim, retries, DLQ, replay, and explicit ACK semantics. Those capabilities must be verified against actual files/tests before relying on them.
- No AgentMail, NocoBase, or LUX runtime integration has been verified in this repository at this point.

## 9. Explicit non-goals for V1

- No rewrite or replacement of SAMURAI Core.
- No direct database sharing with NocoBase.
- No autonomous email sending.
- No public production deployment or use of live customer mail.
- No hardcoded API keys, sample production secrets, or secret values committed to Git.
