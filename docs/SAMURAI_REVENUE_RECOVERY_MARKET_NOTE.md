# SAMURAI Revenue Recovery — Kazakhstan Market Decision Note

**Research snapshot:** 9 November 2026  
**Decision:** run a bounded Kazakhstan validation experiment; no final product winner selected  
**Primary experiment:** lead-response audit for HVAC / climate service companies  
**Parallel research:** accounts-receivable workflow for engineering contractors and equipment suppliers

## 1. Decision

Do not position SAMURAI as another generic CRM, chatbot, AI receptionist or home-services marketplace.

The existing code is a read-only audit of recorded first-response times and outcome groups. The first paid offer should be a fixed-scope diagnostic on a pseudonymized export. A broader lost-opportunity workflow (quote sent, no next action, overdue follow-up, job completed, invoice unpaid) is a product hypothesis that still requires additional fields, logic and customer evidence.

Lead Recovery is the primary experiment because it is closer to the existing code. AR Recovery should remain a parallel discovery track because Kazakhstan already has a direct receivables-management competitor.

## 2. Market signals — not proof of demand

- A Kazakhstan SME survey reported demand for marketing tools/automation and CRM/ERP integration. This is a broad adoption signal, not evidence that HVAC firms will buy SAMURAI.
- A 2026 Kazakhstan CRM study reported CRM use among surveyed businesses and a fragmented vendor mix. It does not establish the CRM penetration of the target HVAC segment.
- Instant messaging is widely used in Kazakhstan, but public data does not establish the average HVAC response time or the percentage of WhatsApp inquiries lost.
- Therefore the central problem hypothesis — missed or delayed follow-up after an inquiry or estimate — must be verified in discovery interviews and redacted customer exports.

## 3. Primary ICP

HVAC / climate installation, repair and maintenance companies in Almaty and Astana.

Qualification hypotheses:
- 30+ inbound inquiries per month;
- multiple technicians or field teams;
- a mix of installation, repair and maintenance work;
- inquiries arrive through WhatsApp, Instagram, website and phone;
- owner/director or sales/operations manager can approve a paid diagnostic;
- CRM or lead inbox has creation time, first-response time and outcome;
- company can provide a minimal pseudonymized export.

Secondary cohorts: plumbing/heating and electrical/engineering contractors. Track each vertical separately; do not blend results.

## 4. Competitive landscape

| Provider | Category / public offer | Implication |
|---|---|---|
| Bitrix24 Kazakhstan | General CRM; published paid tiers | Broad CRM substitute; SAMURAI must not compete as another CRM |
| SotaCRM | CRM for sales/service teams and messaging workflows | Direct workflow substitute |
| Syntony | AI administrator and CRM for service businesses | Direct AI receptionist/automation substitute |
| RemOnline | Service-business CRM, orders and communications | Direct operational-system substitute |
| UWork / Jondey | Service-provider marketplaces | Compete for discovery and lead generation, not the same audit |
| debitorka.kz | Kazakhstan receivables management, reminders, promises, integrations and analytics | Strong local substitute for generic AR management |
| Qut Pay / 1C UNF | Invoice/payment tracking and accounting workflows | Adjacent AR substitutes |

Publicly listed prices and product claims change; re-check vendor pages before quoting them in a customer proposal. Vendor-published descriptions are not independent proof of customer outcomes.

### Positioning

**SAMURAI Lost Opportunity Scanner** — a read-only audit that finds response-time gaps and, after future product work, leads/quotes with no next action. It complements an existing CRM rather than replacing it.

The defensible value, if validated, must come from trustworthy evidence, vertical-specific workflow knowledge, fast setup, data minimization and repeatable delivery — not from the generic use of AI.

## 5. 200-company research plan

Target list allocation (planning targets, not verified market counts):

| Segment | Companies |
|---|---:|
| HVAC / climate | 70 |
| Plumbing / heating | 30 |
| Electrical contractors | 20 |
| Engineering contractors (AR discovery) | 40 |
| HVAC suppliers / installers (AR discovery) | 20 |
| Other B2B service firms (AR discovery) | 20 |
| **Total** | **200** |

Geographic allocation target:
- Almaty: 100
- Astana: 70
- Shymkent: 30

Use public company listings, company websites, business directories and public business profiles. Record source and date. Avoid unnecessary personal data and do not scrape private contact details. Each company remains an unqualified prospect until a human verifies segment, activity, volume and decision-maker.

Recommended fields: prospect_id, company, city, vertical, public website, public business contact/source, service mix, team-size signal, channel signals, CRM/export availability, decision-maker role, qualification status, last action, opt-out.

## 6. Lead Recovery offer

**Paid Lead Response Audit — 49,000 ₸ (price hypothesis)**

- one pseudonymized CSV export;
- maximum 10,000 rows;
- required fields only: lead_id, created_at, first_response_at, outcome;
- response-time distribution, SLA compliance and outcome groups;
- data-quality report and operational recommendations;
- no CRM write access, no outbound messaging and no guaranteed revenue claim.

Potential recurring offer after a successful audit: 39,900–59,900 ₸/month for repeat audits, overdue follow-up visibility and recovery tracking. Integrations and automated messaging are separately scoped.

## 7. AR Recovery parallel track

Do not build a generic debt reminder product: debitorka.kz already offers a local receivables-management proposition with reminders, payment promises, analytics and integrations.

Test a narrower workflow among engineering contractors and equipment suppliers:
- staged payments and advances;
- approved quote → completed job → invoice → unpaid balance;
- payment promise dates;
- project-level gross margin and overdue exposure.

Hypothesis: linking lead, quote, job and invoice may provide a better operational view than a standalone debt reminder tool. This is not validated. First conduct 5–10 interviews and inspect anonymized workflow examples before implementation.

## 8. Outbound validation

Manual, individually reviewed sequence only:
- Day 0 research and qualification;
- Day 2–3 first business contact;
- Day 5–6 one permitted follow-up;
- Day 9–10 synthetic report example;
- Day 14–15 close the loop and stop.

No messages have been sent by this plan. Do not launch a bulk campaign. Respect opt-outs, channel rules and applicable Kazakhstan privacy/marketing requirements.

## 9. Budget and founder capacity

- MVP budget ceiling: $3,000.
- Initial validation spend target: ≤$1,700.
- Reserve the remaining $1,300 until a paid buyer or a documented delivery need exists.
- Founder capacity: 10 hours/week.
- Weekly allocation: 2h prospecting, 2h personalized preparation, 2h contact/follow-up, 2h interviews/demos, 2h product/data work.

Do not spend on a mobile app, full CRM, voice AI, complex WhatsApp integration or public production deployment before paid validation.

## 10. 90-day gates

**Days 1–14:** technical audit, privacy-safe synthetic demo, 50 prospects, 5 discovery interviews, AR interview guide.

**Days 15–30:** 100 qualified prospects, data availability checks, first paid-audit proposals.

**Days 31–60:** 200 prospect target, 1–2 paid pilots sought, validate report accuracy and delivery hours.

**Days 61–90:** measure outcomes, renewals, margin and support burden; decide whether to continue, narrow or stop.

Planning estimates (low confidence; not empirical conversion rates):
- Lead Recovery: 25–40% chance of at least one paid pilot; 15–25% chance of at least one MRR customer by day 90.
- AR Recovery: 15–30% chance of at least one paid pilot; 10–20% chance of at least one MRR customer by day 90.

These ranges must be replaced with observed funnel data as soon as outreach begins.

## 11. Go / no-go gates

- 10 interviews and no confirmed pain → revise ICP.
- Confirmed pain but no usable data → redesign the audit.
- Usable data but inaccurate findings → improve the algorithm.
- Interest but no willingness to pay → do not expand development.
- 2 paid pilots with measurable value → continue product work.
- 2 renewals → prepare a repeatable MRR offer.
- 3 paying accounts with renewals and positive contribution margin → consider scaling.

## 12. Evidence boundary

No paying customer, recovered revenue, MRR, causal uplift, live WhatsApp integration or production deployment is confirmed by this note. CI success and synthetic examples are technical evidence only.
