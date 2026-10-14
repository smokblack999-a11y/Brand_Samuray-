# SAMURAI Lead Engine — International Paid Pilot

Status: **commercial pilot plan; not evidence of a production deployment or a paying customer.**

## 1. Offer

SAMURAI Lead Engine helps a small service business control incoming enquiries: collect leads, prioritize them, prepare reply drafts, track follow-ups, and report what happened to each lead.

**Initial delivery model:** paid setup + monthly support. Start with one paid pilot. Quote in the client's billing currency (for example USD, EUR, or GBP); do not publish a universal price until discovery calls validate willingness to pay and support cost.

### Pilot promise (bounded)

For one agreed inbound channel and one team, configure a measurable workflow that reduces missed enquiries and makes follow-up status visible. Do not promise a sales lift or fully autonomous AI. Replies remain human-approved until safety and quality are demonstrated.

## 2. Ideal first customer

Qualify a business only if all are true:
- It receives recurring inbound enquiries through a channel the pilot can actually access.
- A human currently loses time triaging, drafting, or remembering follow-ups.
- One owner can approve the workflow and provide anonymized test examples.
- It can define a baseline and review results weekly.
- It agrees to a paid, time-boxed pilot and a named decision-maker.

Disqualify customers requiring unsupported channels, sensitive/high-risk automated decisions, guaranteed revenue, or unattended sending before end-to-end testing.

## 3. Scope and exclusions

### Included in the first pilot
- One channel and one business workflow, agreed before setup.
- Lead record: source, timestamp, status, priority, next action, owner.
- AI-assisted reply draft with human approval.
- Follow-up queue and missed-lead view.
- Basic audit trail for status changes and generated drafts.
- Weekly report against the agreed baseline.
- Handover notes and one operator training session.

### Not included unless separately tested and contracted
- Guaranteed sales, lead volume, or conversion lift.
- Autonomous sending to customers.
- Multiple CRM/channel integrations.
- A mobile app rebuild, custom analytics warehouse, or bespoke model training.
- Payment collection or live billing automation.
- Any claim that a Telegram user-account session works until credentials and device/account E2E tests pass.

## 4. Pilot acceptance criteria

Before setup, record the baseline for the previous 7–14 days if available:
- Number of incoming enquiries.
- Median first-response time.
- Number and percentage with no recorded follow-up.
- Current handling time per enquiry (rough estimate is acceptable if labeled).

For the pilot, agree on a target with the customer rather than inventing one. At minimum, acceptance requires:
1. Every test enquiry is recorded once; duplicate events do not create duplicate leads.
2. A lead can be assigned a status, priority, owner, and next action.
3. AI drafts are clearly marked as drafts and cannot be sent without approval in the initial mode.
4. Unauthorized requests cannot read or modify another customer's data.
5. Failures are visible in logs/dashboard and do not silently lose the event.
6. The weekly report reconciles test events against the source channel.
7. Customer signs off on the workflow and training.

A successful technical test is not, by itself, evidence of commercial value. Renewal depends on the customer's measured result and willingness to pay.

## 5. Commercial structure

Quote in the client's currency and put the amount, tax treatment, payment schedule, scope, support window, data handling, cancellation, and acceptance criteria in writing.

Suggested structure, with amounts left to discovery:
- **Setup fee:** workflow mapping, configuration, test run, handover.
- **Monthly maintenance:** monitoring, limited support, agreed small improvements.
- **Pilot term:** short and fixed; specify start/end dates and review date.
- **Change requests:** separately estimated; no unlimited custom work.

Do not describe revenue as passive income. Setup and support consume time; track delivery hours and direct costs before deciding whether the monthly fee is profitable.

## 6. First-customer acquisition — 14-day execution

### Days 1–2: choose one vertical
Pick one vertical where missed enquiries have a clear cost (for example, agencies or local service providers). Do not prospect several unrelated verticals at once.

### Days 3–5: build a qualified list
Find 20 businesses with a visible inbound enquiry path. Record business name, decision-maker, public contact route, observed workflow problem, and why the offer may fit. Use public business information only; comply with applicable outreach and privacy rules.

### Days 6–10: personalized outreach
Send a short, individually relevant message. Do not claim an integration, result, or customer case that has not been verified.

Suggested first message:

> Hi — I noticed that your team receives enquiries through [public channel]. I’m testing a small lead-operations service that helps teams track incoming enquiries, prepare reply drafts for approval, and keep follow-ups from being forgotten. I’m looking for one business to run a paid, time-boxed pilot with agreed success measures. Would a 15-minute workflow review be useful? If this is not relevant, I won’t follow up.

Use only the channel's permitted business-contact practices; honor opt-outs.

### Days 11–14: discovery and proposal
Ask:
- How many enquiries arrive in a typical week?
- Where do they arrive, and who owns the response?
- What gets missed today, and how do you know?
- What tools and access are permitted?
- What measurable change would make a paid pilot worth renewing?
- Who approves the purchase and what is the buying timeline?

Then send a one-page proposal with scope, price in client currency, timeline, data/security boundaries, acceptance criteria, exclusions, and cancellation terms. Do not start custom integration work before written acceptance and the agreed initial payment.

## 7. Security and readiness gate

Before real customer data is used:
- Verify authentication, tenant/data isolation, secret handling, and least-privilege access.
- Use synthetic or redacted data for demos.
- Keep autonomous sending disabled until explicit customer approval and end-to-end tests.
- Verify backups/retention/deletion and incident contact.
- Test duplicate delivery, invalid signatures, timeouts, provider failures, and retry behavior.
- Confirm the chosen channel's current API permissions and terms.
- Record evidence for each check; mark untested items **BLOCKED**, not PASS.

## 8. Go / no-go decision

**GO to a paid pilot only when:** a named customer accepts the scope and price in writing; access is authorized; the security/readiness gate passes for that scope; and a baseline plus review date are recorded.

**NO-GO / pause when:** the customer expects guaranteed revenue, required access is unavailable, data isolation is unverified, or critical failures are silent.

After the pilot, continue only if the customer confirms value, the support load is sustainable, and the economics work in the client's currency after direct costs and delivery time.

## 9. Evidence log

Track each item with date, test input, expected result, actual result, artifact/link, and owner:
- [ ] Current repository revision and passing relevant CI
- [ ] Deployed HTTPS endpoint and health check
- [ ] Authentication and tenant-isolation test
- [ ] Channel connection and real inbound-event test
- [ ] Duplicate/retry/failure-path tests
- [ ] Human approval enforced for outbound replies
- [ ] Baseline and pilot success measures agreed
- [ ] Signed scope and initial payment received
- [ ] Customer acceptance and renewal decision

Until the relevant evidence exists, deployment, channel operation, customer acquisition, payment, and revenue remain **unverified**.
