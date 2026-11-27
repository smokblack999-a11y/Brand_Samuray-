# SAMURAI Revenue MVP — implementation specification

Date: 2026-11-27
Status: proposed, not implemented
Target vertical: auto service and detailing businesses
Channels: Telegram Business + owner web panel
Budget ceiling for stage 1: 50,000 KZT; no spending authorized by this document.

## Product outcome
A business owner can receive Telegram inquiries, capture a structured lead, review it in a private web panel, update its status, and send a human-approved response. AI may classify and draft responses from owner-approved service data. It must not invent prices, availability, discounts, repair diagnoses, or payment state.

## Critical architecture decisions
1. **No shared global lead store for SaaS.** Every tenant-owned record has an immutable `tenantId`; every read, update, export, and action is scoped by authenticated tenant identity on the server. Never trust a tenantId supplied only in request body/query.
2. **Do not extend current JSON store into multi-tenant production.** Current `core/store.js` persists a single `leads.json`. Use a transactional database for the pilot/SaaS path, with migrations, unique constraints, backups and restore tests. Select the actual database only after checking deployment constraints.
3. **Durable webhook ingestion.** Verify Telegram secret, validate payload, persist an idempotent inbox event and enqueue work before returning success. Worker claims jobs with leases, bounded retries and dead-letter state. A failure after HTTP 200 must remain recoverable.
4. **Explicit tenant mapping.** Resolve Telegram `business_connection_id` to a tenant using a server-side mapping created during authenticated onboarding. Unknown connections are rejected/parked; never route them to a global default business.
5. **Grounded AI.** Build prompt context from tenant service catalog, approved price policy, working hours and booking rules. Missing facts result in a clarification or human handoff. Keep AI output as a draft until pilot quality and guardrails are validated.
6. **Human approval initially.** Owner approves quotes, booking commitments, refunds, discounts and payment confirmation. No autonomous financial actions.
7. **Secrets and privacy.** Encrypt credentials at rest where supported; redact tokens, phone numbers and message bodies from logs; define retention, export and deletion; separate test data from production.

## Minimal data model
- tenants(id, name, timezone, status, created_at)
- tenant_users(id, tenant_id, auth_subject, role, status)
- telegram_connections(id, tenant_id, business_connection_id, status, created_at), unique(business_connection_id)
- service_catalog(id, tenant_id, name, description, price_from, price_to, duration_minutes, active, updated_at)
- leads(id, tenant_id, source, telegram_chat_id, customer_ref, customer_name, phone, vehicle, service_id, requested_at, status, message, intent, score, ai_draft, owner_id, created_at, updated_at)
- inbox_events(id, tenant_id, provider, provider_event_id, payload_ref, status, attempts, next_attempt_at, last_error_code, created_at), unique(provider, provider_event_id)
- audit_events(id, tenant_id, actor_id, action, entity_type, entity_id, metadata_redacted, created_at)

Do not persist unnecessary sensitive data. Customer identifiers should be minimized and access-controlled.

## Minimal owner panel
- Sign-in and tenant-scoped session.
- Lead inbox with status filters: new, needs_info, awaiting_owner, booked, completed, lost.
- Lead detail: customer request, vehicle, requested service/time, AI draft, event history.
- Service catalog editor with explicit price ranges and operating hours.
- Owner actions: edit draft, send approved reply, change status, assign staff.
- Basic metrics: inquiries, first-response time, booked leads, completed jobs. Revenue metric only from reconciled business-entered/verified data.

## API boundary (proposed)
- POST /api/revenue/webhooks/telegram — authenticated provider webhook; durable inbox only.
- GET /api/revenue/leads — tenant-scoped list with pagination/filter.
- GET /api/revenue/leads/:id — tenant-scoped detail.
- PATCH /api/revenue/leads/:id — allowlisted status/assignment fields only.
- POST /api/revenue/leads/:id/draft — generate grounded AI draft.
- POST /api/revenue/leads/:id/send — owner-authorized send; audit event required.
- CRUD /api/revenue/services — tenant-scoped service catalog.
- GET /api/revenue/metrics — tenant-scoped aggregate.

These are design names, not existing endpoints.

## Acceptance tests / release gates
### G1: isolation and persistence
- Tenant A cannot list, read, update, export or send for Tenant B's lead (404/403 without leaking existence).
- Missing tenant identity is denied.
- Cross-tenant IDs in path/body cannot override authenticated tenant context.
- Concurrent duplicate webhook deliveries create exactly one inbox event/lead.
- Worker crash/restart resumes queued/leased events without data loss.
- Failed events retry with bounded backoff and become inspectable dead-letter items.
- Backup restore recovers tenants, leads, service catalog and inbox idempotency keys.

### G2: Telegram-to-panel demo
- Test tenant is seeded with synthetic data only.
- Valid Telegram update creates one inbox event and one lead.
- Duplicate update does not create a second lead or send a second reply.
- Owner panel shows only that tenant's lead.
- Owner can approve and send a reply; action is recorded in audit log.
- Invalid webhook secret is rejected; unknown business connection is not routed.
- AI draft uses configured service facts; absent price/availability yields a question or human handoff.

### G3: operational safety
- Authentication, CSRF protection where cookie sessions are used, secure cookies, CORS allowlist and rate limits are tested.
- Logs contain request/event IDs but no bot tokens, API keys, raw payment credentials or unnecessary customer content.
- Per-tenant AI usage and spend limits are enforced.
- Feature flags allow auto-reply to remain disabled by default.
- Monitoring, alerting, retention, deletion and restore procedure are documented.

## Commercial pilot exit criteria
- One real auto-service/detailing business signs a pilot agreement and explicitly authorizes Telegram connection.
- At least 30 real inquiries are processed or a minimum 14-day pilot completes (whichever takes longer).
- No cross-tenant data exposure, duplicate sends, lost leads or unverified payment claims.
- Owner confirms workflow value and agrees to a paid subscription.
- Track response time, qualified-lead rate, booked-lead rate, owner time saved, AI cost per tenant and support minutes per tenant.

## Non-goals for stage 1
- Public anonymous marketplace.
- Tor/onion payments or cryptocurrency custody.
- Autonomous refunds or payment transfers.
- WhatsApp until Telegram pilot is stable.
- Multi-location enterprise scheduling.
- Claims of guaranteed revenue uplift.

## Current evidence boundary
Static inspection found the existing Core routes and local JSON lead store. This specification does not claim any proposed schema, endpoint, web panel, queue, billing flow, or tenant isolation is implemented. Runtime tests and a synthetic end-to-end demo are still required.
