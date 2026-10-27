# SAMURAI Revenue Recovery — Sales Validation Kit

Status: internal experiment kit; no customer demand or revenue has been validated yet.

## Objective

Sell one paid, fixed-scope lead-response audit before spending on ads, paid data, or infrastructure.

## Offer to test

**Lead-response audit — $250**
- Reviews one redacted CRM/lead CSV export, up to 10,000 rows.
- Measures recorded first-response times against the client's agreed SLA.
- Separates within-SLA, late-response, and no-recorded-response cohorts.
- Reports data-quality limitations and a short list of operational changes to test.
- No CRM write access, no outbound messages, and no claim that every late/missing response caused lost revenue.
- If the client buys a defined 14-day pilot, credit the audit fee toward the $750 pilot price.

Do not promise recovered revenue before the baseline and follow-up experiment are measured.

## Qualification checklist

A prospect is qualified only when the answer to all required points is yes:
1. Receives roughly 50+ inbound leads per month.
2. Has a CRM or lead inbox with created-at, first-response-at, and outcome fields.
3. Has an owner / sales / operations contact who can approve the audit.
4. Can provide a pseudonymized export without names, emails, phone numbers, message contents, or other direct identifiers.
5. Can explain the approximate gross profit per closed sale.
6. Is willing to pay for a diagnostic if the scope is clear.

Disqualify if they cannot measure response time, have very low lead volume, demand guaranteed revenue, or require automated messaging as a condition of the first audit.

## Short outreach template — English

Subject: Quick question about inbound lead response times

Hi {{first_name}},

I’m testing a focused lead-response audit for {{company}}-type teams. It reviews a redacted CRM export to show response-time distribution, leads with no recorded first response, and how outcomes differ by response group.

It does not require CRM access or send messages, and it does not label missing timestamps as proven lost revenue.

Would a 15-minute conversation be useful to see whether your current lead data can support this kind of audit?

If this is not relevant, let me know and I won’t follow up.

— SAMURAI Revenue Recovery

## Follow-up template

Hi {{first_name}},

One follow-up in case this is relevant: the audit is useful only if your team records lead creation time, first response time, and outcome. If those fields exist, I can explain the fixed scope and what the report can and cannot establish.

Worth a brief look, or should I close the loop?

## Discovery call — questions

1. About how many inbound leads do you receive in a typical month?
2. Where are they recorded today?
3. Are created-at, first-response-at, and outcome available for the same lead?
4. What response-time SLA do you expect the team to meet?
5. What is the approximate gross profit on a typical won deal?
6. Who owns the process and can approve a paid diagnostic?
7. What evidence would make the audit worth paying for?
8. What data handling / retention requirements apply?

Do not collect customer-level personal data during initial qualification.

## Pilot tracking sheet

Track each prospect as one row with these fields:
- prospect_id (pseudonymous internal ID)
- company
- website
- segment
- role
- qualification_reason
- public_contact_source
- contacted_date
- channel
- reply_type (positive / neutral / negative / none)
- discovery_call (yes/no)
- has_required_fields (yes/no/unknown)
- redacted_sample_offered (yes/no)
- paid_audit_offered (yes/no)
- paid_audit_signed (yes/no)
- cash_collected_usd
- direct_cost_usd
- delivery_hours
- next_action
- opt_out (yes/no)

Respect applicable marketing/privacy rules and each recipient's channel preferences. Use a human review before sending; do not mass-blast or automate sending from this MVP.

## Decision gates

Initial planning thresholds, not industry benchmarks:
- First 20 qualified prospects: review whether the segment understands the problem and replies are relevant.
- By 50 qualified prospects: target at least 5 meaningful replies and 2 conversations about actual data availability.
- By 100 qualified prospects: target at least 10 meaningful replies, 3 prospects willing to review a redacted sample/process, and at least 1 paid audit or paid pilot.

If the result misses the gate, diagnose the failure (wrong buyer, weak pain, poor channel, no data, or price) before spending more. Do not interpret 100 prospects as statistical proof of a 78% success probability.

## Cash controls for the $300 experiment

- Hard cap before the first paid customer: $50 total.
- Keep the remaining $250 unspent unless a documented expense is required to deliver a paid engagement.
- No paid ads, annual subscriptions, custom infrastructure, or live payment integration before a buyer commits.
- Record every dollar spent and every dollar collected.
- Calculate net contribution as cash collected minus refunds, payment fees, direct delivery costs, and acquisition spend. Track founder hours separately.
- Revenue multiple is not profit multiple. A 5x net-return test requires net profit divided by invested capital to reach 5; define the measurement window before claiming success.

## Evidence required before scaling

1. A real prospect agreed to the scope.
2. A signed or written acceptance of the paid audit/pilot.
3. Cash actually received.
4. Redacted client data processed and a report delivered.
5. Client feedback and a documented next-step decision.
6. Actual delivery hours, costs, and any repeat purchase/renewal.

A passing CI run proves code checks passed; it does not prove customer demand or business viability.
