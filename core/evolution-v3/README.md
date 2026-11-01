# EVOLUTION V3 — SAMURAI OS module

Status: isolated implementation on feat/evolution-v3-server-foundation. It is not mounted into core/server.js and is not production-ready.

## Implemented primitives

- scrypt password hashing and HMAC session-token primitives.
- PostgreSQL adapter using an injected pg Pool: transactions, workspace membership checks, tenant-scoped site access, revocable persisted sessions, and leased/idempotent Stripe event claims.
- PostgreSQL schema for users, workspaces, memberships, sites, audits, evidence, repair proposals, sessions, Stripe events, subscriptions, and audit log.
- SSRF-resistant public-page fetcher: HTTP/HTTPS only, no IP literals or local/reserved hostnames, DNS validation on every redirect, rejection if any DNS answer is non-public, pinned DNS address for the request, bounded redirects/timeouts/response size, and HTML-only response handling.
- Deterministic Kill Critic checks, human-approval-only repair proposals, evidence-first SEO records, HTML escaping.
- Stripe signature verification and guarded test-mode Checkout/Portal client primitives.

## Conditional HTTP integration

- Express routes are mounted at /api/evolution only when EVOLUTION_ENABLED=true.
- Registration/login use scrypt password hashes, short-lived signed Bearer tokens, persisted session hashes, and server-side revocation checks.
- Account, workspace, membership, and initial session creation are transactional.
- Site onboarding requires a DNS TXT ownership proof before a single-page audit is permitted.
- The audit stores bounded crawler evidence and deterministic title/meta-description/H1 findings; no overall SEO score, rankings, or traffic are fabricated.
- This feature remains disabled by default. Install pg with npm install pg in core, provision a dedicated database, apply schema.sql manually, then configure EVOLUTION_DATABASE_URL, EVOLUTION_SESSION_SECRET (32+ chars), EVOLUTION_SCHEMA_READY=true, and EVOLUTION_ENABLED=true.

## Still not implemented or verified

- The pg driver is not installed in core/package.json. No database has been provisioned and schema.sql has not been applied.
- Routes are conditionally mounted, but no live PostgreSQL database has been provisioned or tested. Email verification, password reset, MFA, account recovery, and billing routes remain unimplemented.
- Crawler has unit tests with mocked DNS/network. No live crawling, site ownership verification, robots policy, crawl queue, Search Console OAuth, rank/traffic source, or SEO scoring model.
- No real Stripe API round-trip, configured test Price IDs, webhook route, subscription reconciliation implementation, or entitlement activation.
- Repair proposals are not executed; no isolated patch sandbox, CI repair loop, or deploy approval integration is wired.
- No HubSpot changes, Figma artifact, production deployment, or customer pilot.
- Product Design review is source-level only, not captured-screen usability testing.

## Important security boundaries

- The crawler rejects a hostname if any resolved address is private/reserved and pins the selected validated address for the request. Network-level egress restrictions are still recommended.
- DNS is re-resolved and checked for each redirect. Redirects are manual and capped at three.
- PostgreSQL access methods require workspace and user identity for site reads/writes. Do not expose the adapter directly to untrusted clients.
- Stripe event claims use leases; production must monitor expired processing leases and failed-event retries.
- Apply schema only to a dedicated reviewed database. No migration is run automatically.
- Never publish crawler output, AI output, or repair proposals without evidence and explicit human approval.

## Commercial pilot

One agency, one verified domain, five pages, 30 days. Measure operator minutes per page, accepted/rejected findings, rework rate, AI cost, gross margin, and renewal intent. Do not promise ranking lift without independent Search Console/analytics evidence and an adequate measurement window.

## External integrations

HubSpot pipeline/properties remain proposals only. Gmail draft remains unsent. Figma requires Editor access. Stripe remains test-mode-only in code and has not been connected or tested end-to-end.
