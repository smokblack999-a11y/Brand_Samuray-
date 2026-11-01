# EVOLUTION V3 product brief and workflow audit

## Product thesis

EVOLUTION should sell a measurable SEO operations outcome, not generic AI generation. Initial wedge: evidence-backed website findings and human-reviewed repair proposals for small SEO agencies.

## V2 user-flow audit (source-level, not screenshot/usability testing)

### Flow A — sign-up / sign-in
Observed in V2: form-level login and registration UI; password handling does not provide a real credential-verification contract.
Risk: account access is not trustworthy; users cannot safely store client work.
V3 requirement: real identity service, salted password hashes, email verification, password reset, session revocation, secure cookie/CSRF strategy, workspace isolation, and admin MFA.

### Flow B — create project / add website
Observed in V2: local application state and sample workspace concepts.
Risk: browser refresh / another device can lose or diverge state; no verified site ownership.
V3 requirement: persisted workspace + site, ownership verification, explicit data-source status and last-sync time.

### Flow C — SEO analysis
Observed in V2: AI-generated analysis and content operations; no demonstrated Search Console or crawler evidence pipeline.
Risk: users may mistake model output for measured ranking/traffic data.
V3 requirement: every finding shows source, timestamp, URL, severity, reproducible evidence, confidence, and whether it is measured or inferred. No SEO score until a documented scoring model and data source exist.

### Flow D — AI content generation
Observed in V2: content generation workflows.
Risk: output quality, duplicate content, factual claims, HTML safety and publishing are not sufficiently gated.
V3 requirement: content brief → draft → originality/quality checks → factual/evidence review → human approval → export/publish. Never publish by default.

### Flow E — billing / upgrade
Observed in V2: simulated upgrade path rather than verified Stripe Checkout + webhook lifecycle.
Risk: entitlements can be shown without settled payment.
V3 requirement: server-created Checkout Session, signature-verified webhook, durable idempotency, subscription reconciliation, entitlement state derived from Stripe, and customer portal. Seller-country eligibility must be confirmed before implementation.

## Core UX weaknesses

1. No clear distinction between measured facts, model suggestions, and demo/sample data.
2. No visible evidence provenance for SEO claims.
3. AI generation is the center of the UI, while the paid outcome (issues resolved, time saved, retained customers) is not.
4. Billing trust is undermined by simulated upgrade behavior.
5. No complete multi-user workspace / permissions / client-project boundary.
6. No safe approval lifecycle for code/content repairs.
7. Local state does not provide dependable cross-session continuity.
8. No onboarding sequence that proves site ownership and explains data permissions.

## V3 information architecture

- Overview: workspace health, connected sites, latest audit, blocked proposals, verified costs.
- SEO Intelligence: evidence-backed technical/content findings, crawl coverage, Search Console metrics.
- AI Repair Agent: proposal queue, diff preview, risk, evidence, sandbox/CI status, approval.
- Kill Critic: deterministic rules, verdict, failed checks, evidence gaps, fingerprint, audit trail.
- Revenue Monitor: subscription state, settled invoices, usage costs, gross margin, renewal indicators.
- Workspace: sites, members, roles, integrations, retention, export.

## Key interaction rules

- Every metric has a provenance badge: Measured / Imported / Estimated / AI-derived / Missing.
- Empty states explain the next concrete action; never fill dashboards with fabricated values.
- Every repair proposal shows the exact target, evidence, risk, rollback plan, and human approver.
- Critical/high-risk changes cannot be auto-applied.
- Failed or unverified integrations remain visibly disconnected.
- Revenue cards distinguish MRR, collected cash, failed invoices, refunds, and AI cost.
- All destructive or external actions require confirmation and are logged.

## Design tokens

- Canvas: #0B0D12; surface: #141923; elevated: #1B2230.
- Primary accent: violet; verified pass: green; warning: amber; blocked/error: red.
- Text: high-contrast neutral; secondary: muted slate.
- Typography: Inter for UI; JetBrains Mono for IDs, logs, metrics and diffs.
- Components: compact left navigation, persistent workspace selector, evidence drawer, activity timeline, approval modal, diff viewer, integration status chips.
- Responsive behavior: desktop-first for agency workflows; tablet usable; mobile focuses on approvals and alerts.

## HubSpot CRM proposal (not written)

### Suggested stages
1. Target identified
2. Contacted
3. Discovery booked
4. Website qualified
5. Pilot proposed
6. Pilot active
7. Pilot review
8. Closed won
9. Closed lost

Keep existing HubSpot pipeline unchanged until owner approval.

### Suggested properties
- Website Domain (single-line text)
- Audit Status (dropdown: not started, queued, completed, blocked)
- SEO Score (number; blank until measured)
- SEO Score Evidence URL (URL)
- Critical Issues (number)
- Last Audit Date (date)
- Search Console Connected (boolean)
- Pilot Start Date (date)
- Baseline Minutes Per Page (number)
- Pilot Minutes Per Page (number)
- Estimated Monthly AI Cost (number)
- Renewal Intent (dropdown: unknown, positive, neutral, negative)

### Qualification rubric
- At least 3 managed websites or repeated SEO delivery work.
- Clear time-consuming workflow (audits, content QA, technical fixes).
- Named owner/operator who can approve a pilot.
- Permission to test on a site they control.
- Willingness to share baseline time and success criteria.
- Budget/intent to pay after a successful pilot.

## Pilot offer

One agency, one verified domain, five pages, 30 days.
Baseline: minutes/page, defect/rework rate, evidence coverage, current tools/cost.
During pilot: findings accepted/rejected, repair proposals accepted/rejected, operator minutes, AI cost, issues safely resolved.
Success: measurable time saved, acceptable quality and safety, positive willingness to pay. Search ranking lift is not a 30-day guarantee and must be measured independently over an appropriate period.

## Decision gates before public launch

- Database adapter + tenant isolation + backups tested.
- Auth and session lifecycle tested, including revocation and CSRF.
- SSRF-safe crawler tested against redirects, DNS rebinding and private IP ranges.
- Search Console OAuth consent and token storage reviewed.
- Stripe seller eligibility, Checkout, webhook retries and entitlement reconciliation tested in sandbox.
- HubSpot mapping approved; no mass imports.
- Security review and dependency audit pass.
- CI passes on the latest PR head.
- Pilot customer explicitly consents and provides a controlled test site.
