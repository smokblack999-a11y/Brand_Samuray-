# SAMURAI Revenue — Read-only code audit (2026-11-27)

## Scope and method
Remote inspection of the repository default branch `main`; files reviewed: `core/server.js`, `core/package.json`, `core/business-bot.js`, `core/.env.example`, `core/store.js`, `core/lead-engine.js`, `core/rate-limit.js`, `core/openai.js`. This is a static source review only. No local runtime, deployment, database, secrets, or end-to-end Telegram/payment tests were executed in this audit.

## Verified assets
- Node.js / Express core, package scripts: `start`, `test`, `verify-config`, `set-webhook`.
- `GET /health` and `GET /ready`; readiness checks API key, Telegram webhook secret, and stats availability.
- API-key protected lead/stats endpoints and agent-control endpoints.
- `POST /api/lead/analyze`: lead scoring and optional AI response generation; rate limiter attached.
- Telegram Business webhook: webhook secret validation, duplicate-event claim, lead record update, optional auto-reply controlled by `AUTO_REPLY=true`.
- `business-bot.js` sends Telegram Business messages via Bot API.
- dual-AI endpoints, sessions, export, and rate limiting.
- Core uses environment configuration and production startup checks for API key and webhook secret.

## Additional code-level findings\n- Lead storage is a local JSON file (`leads.json`) with atomic temp-file rename, but no database transactions, tenant field enforcement, retention policy or concurrency guarantees for multi-instance deployments were verified.\n- Lead scoring is heuristic keyword matching, not a validated conversion predictor; treat it as triage only.\n- AI reply generation uses business name and lead score, but reviewed prompt has no verified service catalog/pricing/appointment availability context. It instructs the model not to invent these facts, but factual grounding is limited by supplied context.\n- OpenAI client uses a configured timeout and two retries; errors are sanitized into general categories.\n\n## Risks / gaps for commercial MVP
1. **No multi-tenant boundary visible in reviewed routes:** current endpoints appear core-wide; do not expose as shared SaaS until tenant authorization/data isolation is designed and tested.
2. **No customer-facing web panel verified:** no web dashboard implementation was reviewed in this scope.
3. **Billing lifecycle unverified:** no subscription/payment webhook reconciliation or subscription entitlement enforcement was reviewed.
4. **Telegram reply automation is conditional:** `AUTO_REPLY` defaults off; auto reply requires a generated reply and enabled flag.
5. **Webhook work is acknowledged before processing:** route sends HTTP 200 immediately then processes asynchronously in the request handler; durable queue/retry/dead-letter behavior was not established.
6. **Rate-limit scope:** lead-analyze and dual-AI endpoints have limiters; Telegram webhook and other routes should be reviewed for abuse controls and deployment-level throttling.
7. **Timeout behavior:** request timeout timer sends 503 if response has not been sent, but does not cancel underlying application work.
8. **Readiness/health are not proof of full functionality:** health is shallow; readiness does not verify external Telegram/OpenAI connectivity, billing, dashboard, or tenant workflows.
9. **Production deployment, TLS, secrets management, data backup, privacy notices, retention and deletion procedures remain unverified.**

## Recommended product definition (initial vertical)
SAMURAI Revenue for auto-service/detailing businesses:
- Customer sends a Telegram message.
- Bot answers from approved business facts/service menu and asks for required details.
- Lead/order is saved with contact, vehicle/service request, preferred time, and status.
- Owner receives notification and can confirm or follow up.
- Customer receives confirmation/reminder.
- Web dashboard shows leads, status, response time and conversion.
- Human approval for quotes, schedule commitments, refunds and payment status until safeguards exist.

## Release gates
- **G0 audit:** done (static review only).
- **G1 isolate:** create a feature branch; preserve main and all working branches.
- **G2 demo:** one fake/test business tenant, synthetic data, no public access; customer intake -> lead -> owner notification -> manual status update.
- **G3 safety:** tenant isolation tests, API auth, webhook signature, idempotency, rate limits, secret scan, logs with redaction, backup/restore check.
- **G4 pilot:** one real business with explicit consent, limited feature flags, monitoring, manual fallbacks.
- **G5 paid:** only after pilot evidence; billing integration and terms, data/privacy, uptime/support expectations.

## Budget gate
Initial authorized cap: **50,000 KZT**, not a spend authorization. No costs incurred or purchases made by this audit. Release spending only after a scoped pilot plan and user approval.

## Evidence status
- Repo and default branch existence/access: verified via GitHub API.
- Static file inspection: verified.
- Local test suite: not run.
- Production deployment: not verified.
- Telegram end-to-end: not verified.
- Payments: not verified.
- Paying customers/revenue: none established by this audit.
