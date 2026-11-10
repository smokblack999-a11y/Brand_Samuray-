# SAMURAI Revenue Recovery — Kazakhstan Execution Plan

**Version:** 1.0  
**Status:** controlled validation plan; no outbound authorized  
**Owner capacity:** 10 hours/week  
**MVP budget ceiling:** USD 3,000

## Product boundary

### Available now
- CSV/JSON lead response audit.
- Up to 10,000 leads per audit.
- First-response SLA groups and outcome comparisons.
- Read-only, stateless processing.
- No outbound messages and no CRM write operations.

### Not available yet
- Quote/estimate follow-up tracking.
- Next-action / due-date engine.
- CRM connectors.
- WhatsApp Business Platform integration.
- Automated recovery sequences.
- Proven customer ROI, paid pilots or MRR.

Do not sell unavailable capabilities as current functionality.

## Product roadmap

### Gate A — privacy-safe audit
- Strict four-column CSV contract.
- Structured JSON parser errors and request IDs.
- API key check before parsing the audit request body.
- Rate-limit, malformed JSON and oversized-body tests.
- No raw customer data in logs.
- Synthetic demo and repeatable operator runbook.

### Gate B — quote follow-up dataset
Only after customer discovery confirms demand, design a separate versioned schema:
- lead_id (pseudonymous)
- quote_created_at
- quote_sent_at
- quote_status
- next_action_due_at
- last_contact_at
- owner_id (pseudonymous)
- job_status
- invoice_status
- outcome

Never add free-text message content or direct identifiers by default. Require a clear data dictionary and field-level necessity review.

### Gate C — managed workflow
- Prioritized list of overdue actions.
- Human-reviewed next-action recommendations.
- Operator marks attempted / contacted / booked / won / lost / not relevant.
- Immutable audit log of operator actions.
- No automatic sending until channel integration, client authorization, opt-out suppression and delivery tests are complete.

## Prospect research plan: 200 companies

| Cohort | Count | Qualification focus |
|---|---:|---|
| HVAC / climate installation and maintenance | 70 | Multiple crews, quote-based work, service contracts |
| Plumbing / heating | 30 | Emergency and scheduled work, repeat clients |
| Electrical contractors | 20 | Estimates, project stages, multiple teams |
| Engineering contractors (AR discovery) | 40 | Milestone payments, invoices, receivables |
| HVAC suppliers/installers (AR discovery) | 20 | Equipment invoices, installation and service |
| Other B2B service firms (AR discovery) | 20 | Recurring invoices and payment promises |
| **Total** | **200** | |

Geographic target allocation: Almaty 100, Astana 70, Shymkent 30. These are research quotas, not claims about actual market size.

### Public research workflow
1. Search public company directories and maps by city and vertical.
2. Verify the company website or active public business profile.
3. Record only public business contact channels and their source.
4. Confirm service mix and signs of multiple teams.
5. Mark CRM, lead volume and decision-maker as unknown until confirmed.
6. Assign one human qualification status: unreviewed / qualified / disqualified / contacted / replied / discovery / data-ready / paid.
7. Deduplicate by website, company name and phone only where the number is a public business line.
8. Record opt-out and never contact again after an opt-out.

### Required spreadsheet fields
`prospect_id, company, city, vertical, website, public_business_contact, contact_source, source_checked_at, service_mix, team_signal, inquiry_channel_signal, monthly_lead_volume, crm_status, export_fields_status, decision_maker_role, qualification_status, last_action_at, next_action_at, reply_status, opt_out`

Do not populate unknown facts by guessing. Do not collect personal home addresses, personal emails or private phone numbers.

## Offer and delivery

### Paid Lead Response Audit
- Test price: 49,000 ₸.
- Scope: one redacted export, maximum 10,000 records.
- Delivery: aggregate report, data-quality note and 3–5 operational recommendations.
- Input columns only: `lead_id, created_at, first_response_at, outcome`.
- No CRM access, no outbound messaging, no revenue guarantee.

### Recurring offer hypothesis
39,900–59,900 ₸/month for repeated audits, overdue follow-up visibility and recovery tracking. This price must be validated; integration and custom workflow work are extra.

### Data handling
- Obtain written client permission and define purpose.
- Client pseudonymizes IDs before transfer.
- Reject additional CSV columns.
- Use encrypted transfer and storage controlled by the operator.
- Limit access to the delivery operator.
- Set a deletion deadline in the engagement agreement.
- Do not put customer rows, tokens or credentials in GitHub issues, PRs, logs or demo fixtures.
- Record only aggregate results in the report.

## Outbound sequence (draft, not sent)
- Day 0: manual company research and qualification.
- Day 2–3: first individually reviewed business message.
- Day 5–6: one permitted follow-up.
- Day 9–10: synthetic report example.
- Day 14–15: polite close-out; stop unless invited to continue.

No bulk messaging, no auto-sending and no contact scraping. Every message must be manually reviewed and honor local law, channel terms and opt-outs.

## Weekly founder schedule
- 2h: prospect research and qualification.
- 2h: personalized message preparation.
- 2h: calls and follow-ups.
- 2h: discovery interviews and demos.
- 2h: product, data and technical quality.

## Budget controls

| Item | Planning amount |
|---|---:|
| Adapt existing audit MVP | $400 |
| Report/export UX | $250 |
| Privacy, security and testing | $300 |
| Minimal infrastructure | $100 |
| Prospecting/list work | $150 |
| Demo and sales material | $150 |
| Contingency | $350 |
| **Initial planned spend** | **$1,700** |
| **Uncommitted reserve** | **$1,300** |

Do not spend reserve funds without a documented delivery requirement or paid customer.

## Success gates
- 10 interviews: confirm recurring pain and data availability.
- 50 qualified companies: at least 5 meaningful replies and 2 data discussions (planning targets).
- 100 qualified companies: at least 1 paid audit target.
- 2 paid pilots: verify delivery accuracy and customer value.
- 2 renewals: consider MRR productization.
- No confirmed pain or willingness to pay: stop feature expansion and revise the segment or offer.

## Separate AR track
Do not build a generic receivables reminder tool before comparing against local debitorka.kz. Interview engineering contractors and equipment suppliers about staged payments, advances, quote approval, job completion and unpaid invoices. Build only if a distinct workflow gap and willingness to pay are demonstrated.

## Release rule
A feature branch and passing CI do not equal production readiness. Merge only after:
- all CI checks pass on the exact PR head;
- privacy and API tests pass;
- code review is complete;
- current `main` compatibility is checked;
- an owner explicitly approves merge and release.
