# BRAND SAMURAY EXCLUSIVE — Unified Intelligence Architecture V1

Status: architecture proposal / audit baseline. No production code is enabled by this document.
Date: 2026-11-25.
Repository: `smokblack999-a11y/Brand_Samuray-`.
Branch: `docs/brand-samuray-exclusive-unified-v1`, created from `main`.

## 1. Product decision

Brand Samuray Exclusive is one product, not a bundle of copied browser extensions. It combines:

1. Knowledge Intelligence — Raindrop-style source collection, highlights, collections, full-text retrieval and provenance.
2. Media Intelligence — Cat-Catch-inspired discovery of media resources available to the user, with lawful download/export controls.
3. Browser Intelligence — User-Agent Switcher-inspired compatibility testing across browser/device profiles.
4. Commerce Intelligence — Buyhatke-inspired price history, offer comparison and price alerts, using permitted data sources.
5. Revenue & Customer Intelligence — WAPI-inspired WhatsApp conversations, campaign attribution, lead stages, sales and ROMI.
6. SAMURAI Intelligence Core — shared evidence model, routing, policy, KILL CRITIC and NEXUS.

The product's differentiator is the shared evidence and business outcome layer: every recommendation should be traceable to sources, and commercial activity should be measurable through lead-to-sale outcomes.

## 2. Existing repository facts and safety boundary

The current GitHub `main` README describes SamuraiOS as a Telegram Business AI Lead Agent with lead scoring, AI reply generation, human approval by default, API authentication, health/readiness endpoints and CI workflows. It explicitly says not to expand the MVP until real messages from at least one pilot business have been tested.

The GitHub branch `feat/x10thinc-hamylion-v3` contains additional Android Mini App/media capture and HAMYLION event infrastructure. A GitHub compare performed on 2026-11-25 reports the branch and `main` have diverged: feature branch is 52 commits ahead and 72 behind. They are not safe to merge blindly.

Rules:
- Do not force-push, reset, overwrite, or merge either line as part of this initiative.
- Do not declare a feature production-ready based only on a branch name, README, or a passing unit test.
- Reconcile branch histories and inspect the current local Termux working tree before implementation.
- This architecture branch is documentation-only. No runtime, dependency, database, Android, Telegram, payment or production configuration is changed here.

## 3. Unified architecture

```text
Brand Samuray Exclusive UI
        |
SAMURAI API Gateway / Auth / Tenant Boundary
        |
Integration Adapters
  |       |       |        |         |
Raindrop CatCatch UA Lab Buyhatke   WAPI
  |       |       |        |         |
  +-------+-------+--------+---------+
                  |
        Canonical Event / Evidence Bus
                  |
      Evidence Memory + Search / Index
                  |
       KILL CRITIC / Policy Gate
                  |
        NEXUS Orchestration Layer
                  |
     CRM / Orders / Revenue / Reports
                  |
       Existing SamuraiOS Core APIs
```

Adapters must be replaceable. No external provider is the system of record for SAMURAI business decisions. Provider outages must not corrupt the local event ledger.

## 4. Provider roles and constraints

### 4.1 Raindrop.io — knowledge source adapter

Use official REST API/OAuth or official MCP only where the account and plan permit it. Official MCP documentation currently labels the feature beta and Pro-only. Start read-only:
- import bookmark metadata, collection, tags, highlights and supported content;
- retain canonical source URL, provider item ID and capture time;
- deduplicate by provider ID and canonical URL;
- never treat a saved item or highlight as verified truth;
- never place OAuth tokens in frontend code, repository files or logs.

Do not make Raindrop a required runtime dependency. If disconnected, SAMURAI's own evidence store and search continue to work.

### 4.2 Cat-Catch — media discovery adapter

Adopt the capability concept, not an unreviewed code copy:
- discover media resources exposed by the page/session;
- show type, URL origin, size/quality where available;
- allow user-initiated save only when the user has rights and the site permits it;
- preserve source URL and capture timestamp.

Do not bypass DRM, paywalls, access controls, or platform restrictions. Treat media URLs and page scripts as untrusted input. Inspect upstream source and exact license before any code reuse.

### 4.3 User-Agent Switcher — browser QA adapter

Use for compatibility testing, not anonymity claims or evasion:
- named test profiles (desktop/mobile/browser);
- per-tab/domain test configuration;
- test reports for rendered behavior and response differences;
- reset to native browser identity by default.

User-Agent spoofing does not make a browser anonymous and does not reproduce a complete device fingerprint. Keep this feature opt-in and clearly label simulated profiles.

### 4.4 Buyhatke — price intelligence concept

No public Buyhatke API contract has been verified in this audit. Do not scrape its private service or assume permission to reuse its data. Build a provider-neutral price observation model and use:
- merchant APIs/feeds with permission;
- user-supplied product URLs where automated access is permitted;
- approved affiliate/catalog feeds;
- manual price observations for the first prototype.

Track currency, tax/shipping inclusion, seller, variant, condition, timestamp, source and confidence. Alert only on comparable product variants. A low price is not proof of a legitimate seller or a genuine discount.

### 4.5 WAPI.kz — customer messaging and attribution adapter

WAPI provides a documented REST API, webhooks, MCP and CLI; its documentation describes sandbox mode, message history/media, tracked links, lead stages, sales values and campaign/ROMI analytics. The sandbox can test message flows and webhook handling without a real WhatsApp number. Published limits include 500 sandbox messages/day and five test recipients.

Important risk: WAPI explicitly says its WhatsApp connection is unofficial/WhatsApp-Web-like and carries account-blocking risk. Its Meta ads connection is marked beta. Published price is 330 KZT/day (9,900 KZT/30 days) per active number. Therefore:
- first integrate sandbox only;
- production number connection requires a separate owner decision after a risk review;
- never use cold bulk messaging; require lawful consent and opt-out handling;
- keep a human approval gate for outbound messages until pilot evidence supports a controlled policy;
- verify every webhook HMAC-SHA256 signature against the raw request body, enforce timestamp tolerance, deduplicate event IDs and persist delivery state;
- use account-scoped or number-scoped keys with least privilege;
- redact phone numbers and message bodies from routine logs;
- define retention, deletion and export policies before storing customer messages locally.

WAPI's privacy policy describes processing of message content, phone/name data, click identifiers, IP/geolocation, advertising cookies and Meta campaign data. It states data is stored in Kazakhstan, while also describing certain cross-border processors (including Meta, Google and Telegram). The business using the service remains responsible for lawful processing of its customers' data. Complete a Kazakhstan personal-data/legal review before a live pilot.

## 5. Canonical data model

All provider adapters normalize into versioned internal records. Initial types:

- `SourceRecord`: provider, provider_item_id, canonical_url, title, author/domain, captured_at, content_type, tags, collection, license/rights note.
- `EvidenceRecord`: source_id, excerpt, content_sha256, source_trust, verification_status, corroborating_source_ids, created_at, supersedes_id.
- `MediaAssetRecord`: source_id, origin_url, media_type, mime_type, size, checksum, rights_status, storage_ref.
- `BrowserTestRecord`: target_url, profile_id, browser_version, test_timestamp, observed_result, differences, limitations.
- `PriceObservation`: product_key, variant, merchant, seller, price, currency, shipping, tax, availability, observed_at, source_id, confidence.
- `CustomerEvent`: provider, provider_event_id, tenant_id, contact_ref, conversation_ref, direction, source, event_time, received_at, payload_ref, signature_status.
- `LeadRecord`: contact_ref, acquisition_source, campaign_ref, stage, value, currency, owner, consent_status, event_history.
- `OrderRecord`: order_id, lead_id, items, amount, payment_status, fulfillment_status, evidence_refs.
- `DecisionRecord`: decision_id, claim, evidence_ids, critic_result, policy_version, human_approval, outcome.

Minimum trust states:
- `unverified`: captured but not checked;
- `source_known`: origin/domain identified, content not independently validated;
- `corroborated`: supported by independent sources;
- `verified`: validated under a documented verification procedure.

A SHA-256 digest establishes content integrity relative to a known digest; it does not prove authorship, truth or authenticity.

## 6. Security and AI safety

- Treat web pages, PDFs, media metadata, chat messages and MCP results as untrusted data, never as system instructions.
- Defend ingestion against SSRF: block localhost, private/link-local IPs, non-HTTP(S) schemes, credentials in URLs, redirects to private networks and oversized responses.
- Store credentials server-side in a secret manager or protected environment; never commit secrets.
- Separate tenants and provider credentials. A provider adapter may access only its tenant's resources.
- MCP tools are exposed through an allowlisted internal tool gateway; do not give external MCP servers unrestricted Core access.
- Read-only by default. Sending messages, changing ads, deleting records, making purchases, publishing, patching code and payments require explicit authorization and audit records.
- Enforce idempotency, bounded retries, rate limits, request timeouts, dead-letter handling and redacted structured logs.
- Preserve source and decision history; never overwrite the original evidence when a source changes.

## 7. Integration with existing SAMURAI work

Reuse where confirmed after local audit:
- existing Telegram Business/Core lead intake and human-approval pattern;
- existing lead scoring and Dual AI;
- existing KILL CRITIC and NEXUS evidence-gate direction;
- existing media ingest/Mini App work on the HAMYLION feature branch;
- existing web-intelligence evidence normalization and source-trust conventions in the local project history;
- existing delivery CRM workflow: order → manual payment evidence review → courier assignment → delivery photo → client notification.

Do not duplicate these modules. First inspect exact files and tests in the currently selected local branch. Some of these modules are not present in the same form on GitHub `main`; do not assume branch parity.

Previously discussed but not confirmed as production-ready:
- R2/S3-compatible Storage Engine: proposed only; audit first; local fallback; private/public separation; signed URLs; target pilot cost $0–5/month.
- Commerce HTTP V1: local work described as not yet installed in the GitHub working branch; default-off.
- Stripe: connected accounts previously identified as test-mode only; live payments not enabled.
- Samurai Delivery CRM Bot: code drafted, real Telegram run and full end-to-end flow not confirmed.
- Android Gallery/server tests: do not mark successful unless performed.

## 8. Delivery sequence and acceptance gates

### Phase 0 — repository and risk audit (mandatory)
- inspect local Termux git status, current branch, remotes, uncommitted files and latest commit;
- compare local branch with GitHub `main` and feature branches;
- inventory existing modules, routes, stores, tests, secrets/config references and deployment state;
- produce a branch map and integration matrix;
- no code modifications.

Exit gate: a verified baseline report with branch ancestry and exact files to reuse.

### Phase 1 — canonical Evidence/Events foundation
- define schemas, validation, versioning, dedupe and persistence interface;
- reuse existing web-intelligence normalization rather than cloning it;
- add tests for source provenance, hash changes, duplicate events, invalid URLs, prompt injection and trust-state transitions.

Exit gate: deterministic tests pass; no provider credentials required.

### Phase 2 — read-only Knowledge and Media
- Raindrop read-only sandbox/OAuth integration;
- media discovery metadata only, user-confirmed export;
- searchable evidence index with source citations.

Exit gate: import, dedupe, deletion/export and security tests pass.

### Phase 3 — Browser QA and Price Intel
- test profiles and repeatable compatibility reports;
- provider-neutral price observations and comparable-product matching;
- no scraping where terms/access rules disallow it.

Exit gate: test fixtures plus at least one permitted live data source; no false price claims.

### Phase 4 — WAPI sandbox and customer/revenue workflow
- sandbox webhook verification and event replay tests;
- lead attribution, stages, order linkage and sales reporting;
- compare WAPI events with local SAMURAI CRM; define source-of-truth and conflict resolution;
- production WhatsApp only after explicit owner approval and risk review.

Exit gate: full sandbox E2E, signed webhook validation, dedupe, manual approval and deletion/export tests.

### Phase 5 — unified dashboard and controlled pilot
- one dashboard for knowledge, media, browser tests, prices, leads, orders and revenue;
- show data freshness, confidence, provenance and unverified status;
- measure response time, lead conversion, sales and operating cost with a real pilot business.

Exit gate: pilot owner confirms utility and measured business result.

## 9. Cost and commercial discipline

- Start with free sandboxes and local fixtures. Do not purchase subscriptions or connect production numbers during architecture work.
- WAPI sandbox is free; live number price is published as 9,900 KZT/30 days per number, with unofficial-connection risk.
- Raindrop MCP availability may require Pro; verify account entitlement before relying on it.
- Buyhatke API availability is unverified; do not budget for an assumed API.
- Storage R2 pilot estimate from prior planning is $0–5/month, subject to actual usage and provider pricing.
- A prior 30-day planning constraint was 3 hours/day and up to 150,000 KZT additional budget; this is a ceiling for planning, not authorization to spend. Approve each paid service separately.

## 10. Definition of done

The unified product is not "done" when the dashboard looks complete. It is done only when:
1. each connected provider has documented auth, scopes, rate limits, license/terms and failure behavior;
2. all records have provenance and explicit trust status;
3. security, tenant isolation, webhook, SSRF, prompt-injection and retention tests pass;
4. external actions are permission-gated and auditable;
5. end-to-end pilot workflows are tested with real, authorized data;
6. measured customer/business outcomes are reported;
7. main is updated only through reviewed PRs after all required CI checks pass.

## 11. Current conclusion

The correct product is a modular, provider-neutral intelligence and revenue platform. WAPI supplies the customer/revenue loop; Raindrop supplies knowledge capture; Cat-Catch supplies media discovery; User-Agent Switcher supplies browser QA; Buyhatke supplies price-tracking patterns. SAMURAI owns the canonical data model, evidence, policies, orchestration and business records.

This file is a design baseline only. No live WAPI number, Raindrop account, Meta ad account, Buyhatke integration, R2 bucket, production payment or browser extension has been connected or tested by this commit.
