# SAMURAI Lead Engine — International Paid Pilot Pack

Status: **proposal / implementation checklist**, not a claim that the service is deployed or production-ready.

## 1. Initial offer

**Positioning:** a managed Telegram Business lead-response workflow for small businesses that receive enquiries through Telegram and need to respond consistently and follow up.

**Sell the outcome, not “AI”:** fewer missed enquiries, faster first response, visible lead status, and a repeatable follow-up process.

### Included in the first paid pilot
- One business, one agreed Telegram Business workflow, and one named operator.
- Capture and deduplicate supported inbound events.
- Lead record with source, status, score, timestamps, and next action.
- AI-assisted reply drafts; a human approves messages by default.
- Follow-up queue and a simple weekly results report.
- Setup, operator handover, and agreed support window.

### Explicit exclusions until separately verified and agreed
- Guaranteed revenue, conversion uplift, or 24/7 human support.
- Unattended auto-replies, bulk messaging, or unsolicited outreach.
- CRM, WhatsApp, email, or other channel integrations not demonstrated in the pilot.
- Custom data residency, regulatory certification, or security guarantees not independently verified.

## 2. Commercial terms to quote

Quote in the prospect's preferred currency. The amount is a commercial hypothesis to test, not a validated market price.

1. **Paid setup:** discovery, configuration, test cases, and operator training.
2. **Monthly service:** hosting/monitoring (if actually provided), maintenance, agreed support, and a monthly outcome review.
3. List separately any third-party API usage, messaging fees, taxes, and out-of-scope changes.
4. Put the scope, start/end dates, support hours, data handling, cancellation, and acceptance criteria in writing.
5. Do not promise an ROI or guarantee a sales result. Agree on measurable operational targets instead.

**Payment gate:** request an agreed setup payment before custom implementation; do not begin bespoke work based only on verbal interest.

## 3. Discovery questions (15 minutes)

- Where do new enquiries arrive today, and approximately how many arrive per week?
- Who answers them, during what hours, and how are missed enquiries noticed?
- What is the typical value of a won customer, if they can share it?
- Which repeated questions consume the most time?
- What counts as a qualified lead, and what follow-up cadence is acceptable?
- Who owns the Telegram Business account and can authorize integration?
- What customer data may be processed, where may it be stored, and when must it be deleted?
- Who approves replies and can pause the workflow immediately?

Disqualify a prospect if they cannot authorize account access, cannot lawfully share the data, expect guaranteed sales, or require unverified integrations.

## 4. Pilot acceptance checklist

The pilot is accepted only when the customer and operator verify the agreed cases.

- [ ] A real authorized test enquiry is received.
- [ ] Duplicate delivery does not create duplicate lead records or repeated actions.
- [ ] Lead score/status and next action are visible to the operator.
- [ ] A reply draft is generated and can be edited or rejected.
- [ ] No customer-facing reply is sent without approval while approval mode is enabled.
- [ ] A failed provider/API call is visible and can be retried safely.
- [ ] Access is authenticated; one customer's data cannot be read by another customer.
- [ ] Logs avoid unnecessary message bodies, credentials, and sensitive personal data.
- [ ] Operator can disable processing and revoke integration credentials.
- [ ] Export/deletion and retention process are demonstrated or documented.
- [ ] Customer signs off on the test results and known limitations.

A CI pass is not a substitute for these real-account and deployed-environment checks.

## 5. Measurement plan

Record a baseline for at least one representative week where practical. During the pilot, report:
- number of inbound enquiries;
- percentage captured successfully;
- median time to first human response (only if timestamps are available);
- number of qualified leads and follow-ups due/completed;
- number of drafts approved, edited, or rejected;
- errors and duplicate events;
- operator time spent, if measured.

Do not claim improved conversion or revenue unless the customer provides a defensible baseline and sufficient outcome data. Agree targets before the pilot starts.

## 6. Prospecting experiment — first 10 business days

These are activity targets, not a sales forecast.

- Build a list of 30 businesses whose public contact channels show active Telegram-based customer enquiries.
- Personalize each message using a specific, publicly observable reason the workflow may help.
- Send one-to-one outreach in accordance with applicable local law and platform rules; no scraping private data or bulk unsolicited messaging.
- Target: 5 meaningful replies, 3 discovery calls, 1 paid pilot. If results miss, review segment, message, and offer rather than claiming the market is validated.
- Do not use fake customer logos, invented case studies, or unsupported performance claims.

### Initial outreach message (English)

Subject: A small pilot to reduce missed Telegram enquiries

Hi [first name],

I noticed that [specific public observation]. I’m testing a managed workflow for businesses that receive customer enquiries through Telegram Business: it organizes incoming leads, prepares reply drafts for staff approval, and tracks follow-ups.

Would a 15-minute conversation be useful to see whether this fits your current process? I can show a short demo using test data. I won’t claim a revenue lift without measuring it with you.

If this isn’t relevant, let me know and I won’t follow up.

Regards,  
[sender name]

Replace every bracketed field with accurate information before sending. Do not send this as a mass campaign.

## 7. Engineering release gates before onboarding a paying customer

- [ ] Deploy to a controlled HTTPS environment and verify the health endpoint (GET /health).
- [ ] Set unique production CORE_API_KEY and TELEGRAM_WEBHOOK_SECRET in the hosting provider's secret manager; never commit or share them in chat.
- [ ] Verify Telegram webhook registration and secret validation with an authorized test account.
- [ ] Verify database/storage persistence, deduplication, restart behavior, and backup/restore.
- [ ] Confirm AUTO_REPLY=false and prove a message cannot be sent without approval.
- [ ] Add tenant isolation before supporting more than one customer.
- [ ] Configure monitoring, error alerts, log retention, incident response, and credential rotation.
- [ ] Review privacy notice, processor terms, retention/deletion, and applicable laws for the customer's jurisdiction.
- [ ] Run the acceptance checklist against the actual deployed service and retain redacted evidence.

**Current known constraint:** repository code and CI alone do not establish that a production service, customer-specific tenant isolation, payment flow, or live Telegram integration is operational. Verify each gate before describing it as available.

## 8. Pilot decision

Proceed only when there is (a) a qualified business owner, (b) written scope and data authorization, (c) an agreed paid setup, and (d) a feasible path through the release gates. If there is no willingness to pay after 30 well-targeted approaches and 3 qualified demos, revise the offer before adding features.
