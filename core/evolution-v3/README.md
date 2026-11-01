# EVOLUTION V3 — SAMURAI OS module

Status: isolated implementation scaffold on feat/evolution-v3-integration-audit.
This is not production-ready and is not mounted into core/server.js.

## Implemented in this branch

- Password hashing and verification with Node.js scrypt.
- Short-lived HMAC-signed session tokens with issuer and expiry checks.
- Deterministic Kill Critic checks for unsafe HTML, credential patterns, missing evidence, and malformed tasks.
- Repair proposals that remain non-applied and require human approval.
- SEO audit records that explicitly do not invent rankings, traffic, or scores.
- HTML escaping helper for plain text output.
- Stripe webhook signature verification over the raw request body, timestamp tolerance, event classification, and injected durable idempotency/reconciliation interfaces.
- PostgreSQL schema proposal for users, workspaces, memberships, sites, audits, evidence, repair proposals, Stripe events, subscriptions, and audit log.

## Explicitly not implemented / not verified

- No database connection, migration runner, backup/restore, or tenant isolation middleware.
- No auth routes or integration with existing SAMURAI session handling.
- No crawler, Google Search Console integration, keyword/rank tracking, or real SEO score.
- No autonomous patch application, repository write, deploy, or website publishing.
- No Stripe Products/Prices configured, no Checkout/Customer Portal route wired into Express, no API round-trip verified, no live webhook endpoint, and no subscription entitlement activation. Guarded test-mode-only Checkout/Portal client functions and webhook signature verification primitives exist in billing.js.
- No HubSpot records/properties/pipeline changes.
- No Gmail draft creation or email sending.
- No Figma file creation; connected account was read-only.
- No Product Design visual audit with captured screens.
- No production deployment.

## Required integration design

1. Keep this module isolated until the API contract, persistence adapter, and auth ownership are agreed.
2. Provision a dedicated PostgreSQL database and apply schema.sql only after review.
3. Implement repository interfaces with transactions, unique Stripe event IDs, workspace scoping, and audit logging.
4. Add Express routes using the existing request ID and rate-limit middleware. Preserve raw request bytes for Stripe signature verification.
5. Integrate auth middleware only after confirming whether SAMURAI Core or EVOLUTION owns identity and session revocation.
6. Connect SEO sources (verified crawler + Search Console OAuth) and store provenance for every metric.
7. Implement repair as proposal → Kill Critic → human approval → isolated sandbox → CI → explicit deploy approval.
8. Configure Stripe only after seller-country eligibility and account ownership are confirmed.

## Commercial pilot

Target: one SEO agency, one verified domain, five pages, 30 days.
Measure baseline and post-pilot operator minutes per page, accepted suggestions, rejected suggestions, defect rate, AI cost, gross margin, and renewal intent.
Do not claim traffic or ranking lift without Search Console/analytics evidence and an adequate measurement window.

## Proposed design-system / screens

- Overview: active sites, audit status, unresolved critical issues, verified monthly spend.
- SEO Intelligence: evidence-backed technical/content findings and Search Console metrics.
- AI Repair Agent: proposed changes, evidence, risk, approval state, sandbox/CI state.
- Kill Critic: verdict, rule IDs, evidence gaps, fingerprints, audit history.
- Revenue Monitor: subscription status, invoices, AI usage cost, gross margin; distinguish estimates from settled payments.
- Settings: workspace roles, integrations, API credentials, retention, audit export.

Visual identity: SAMURAI graphite surfaces; violet for AI; green only for verified pass; amber for warnings; red for blocked findings; Inter for UI and JetBrains Mono for diagnostics.

## CRM field proposal (not created)

Website Domain, Audit Status, SEO Score, Score Evidence URL, Critical Issues, Last Audit Date, Search Console Connected, Pilot Start Date, Baseline Minutes/Page, Current Minutes/Page, Renewal Intent.

## Pricing hypotheses only

Starter $29/mo, Pro $79/mo, Agency $199/mo were present in V2. These have not been validated with customers and are not configured in Stripe.

## Security notes

- Use TLS, secure HttpOnly SameSite cookies, CSRF protection for cookie-authenticated mutations, rate limits, login throttling, password reset, session revocation, and MFA for workspace admins.
- Never expose provider or Stripe secret keys to browser code.
- Treat all crawled page content and AI output as untrusted.
- Prevent SSRF in crawlers: resolve and block private, loopback, link-local, metadata, and reserved IP ranges on every redirect and DNS re-resolution.
- Restrict repair tools to allowlisted repositories/paths and require approval for high-risk changes.
- Stripe webhook processing must be transactional and idempotent. Reconcile subscription state from Stripe rather than trusting the event payload as a direct entitlement grant.
