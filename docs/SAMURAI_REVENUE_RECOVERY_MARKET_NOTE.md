# SAMURAI Revenue Recovery — market decision note

**Research date:** 27 October 2026  
**Decision status:** conditional test, not market-validated  
**Category selected:** paid lead-response leakage audit + managed follow-up improvement for high-value B2B service businesses

## Decision

Do **not** position this as another generic AI chatbot or “AI employee.” Publicly advertised competition already exists in Kazakhstan and internationally. The testable wedge is narrower: a **read-only audit of a client's own lead export first**, followed by a capped, human-approved pilot only if the data shows a meaningful response gap. This lowers implementation risk and makes the first result independent of a long CRM integration.

This is not a claim that the market is undiscovered. Public evidence cannot establish that no competitor serves this need.

## Public competitive evidence

These are vendor-published offers checked on 27 October 2026, not independently audited customer results:

| Provider | Public offer shown | Implication |
|---|---|---|
| Qantalupa (Kazakhstan) | Implementation packages of 79,000 ₸, 149,000 ₸ and 299,000 ₸; AI Lead Assistant is listed as a 14–21 day launch | Generic AI lead-assistant implementation already has local supply |
| Keremet Labs | Basic: 100,000 ₸/month plus 400,000 ₸ setup; Extended: 250,000 ₸/month plus 700,000 ₸ setup | Some providers already charge meaningful setup and recurring fees |
| HH BOT (Kazakhstan) | Published implementation packages from 99,000 ₸ through 699,000 ₸ and recurring options from 29,900 ₸/month | There are multiple local price points and direct substitutes |
| AI Strike Force pricing survey | Reports published workflow prices of $400–$5,000 and support retainers of $200–$2,000/month; survey is from the agency's own commercial research | International services pricing can support higher-ticket implementation hypotheses, but this is not a neutral industry average |

Sources:
- https://qantalupa.kz/ai-assistent-dlya-biznesa-kazakhstan/
- https://keremetlabs.com/en/lead-qualification
- https://hhbot.kz/
- https://aistrikeforce.com/ai-automation-agency-pricing

## Initial customer profile

Start with one segment: **B2B professional-services and specialist agencies in the US, UK or Australia**, roughly 10–100 employees, that already receive a meaningful stream of inbound requests and track deals in a CRM.

Qualify only when the prospect can show:
- approximately 50 or more inbound leads per month;
- creation timestamp, first-response timestamp and a consistent outcome per lead;
- meaningful gross profit per sale (the client supplies the figure);
- an owner, sales lead or operations lead willing to review a 14-day measured pilot.

This segment is a hypothesis chosen for higher potential deal value and the ability to use CSV exports. The code does not yet confirm industry fit, ability to pay, or the count of such businesses.

## Differentiation to test

1. Start from a pseudonymized export; no switch of CRM and no production integration required for the audit.
2. Show the actual response-time distribution and outcome groups, not generic “AI increases sales” claims.
3. Make explicit when timestamps are missing. Missing data is not proof that the customer failed to respond.
4. Run the intervention only after the client agrees to the baseline, SLA, message policy and cost.
5. Keep all outbound messaging human-approved until a real channel integration, opt-in, suppression handling and audit trail have passed separate tests.

Competitors can copy the concept. The defensible edge, if one emerges, must be delivery speed, trustworthy evidence, a repeatable vertical-specific workflow and retained customer relationships.

## First commercial experiment

Target **100 individually qualified prospects**, not a mass blast. Use business-relevant, role-specific outreach and a manual review step. Do not send email automatically from this branch.

Internal decision thresholds (planning targets, not industry benchmarks):
- At least 10 genuine replies or meaningful conversations from 100 qualified prospects.
- At least 3 prospects willing to share a redacted sample/export or review the audit process.
- At least 1 paid audit or paid pilot within the first validation cycle.

If 100 qualified prospects produce no paid pilot, do not add more code to compensate. Change the vertical, offer or channel and run a new test. If prospects cannot provide the data required for measurement, the segment is a poor fit for this exact product.

## Unit economics target

Current pricing is a hypothesis:
- $250 audit, credited toward implementation if the client proceeds.
- $750 for a bounded 14-day pilot.
- $300/week for capped managed monitoring after a successful pilot.

Five recurring accounts at $300/week would represent $1,500/week gross revenue. To reach $1,000/week in operating contribution, total direct delivery and tool costs would need to stay at or below $500/week, before taxes and founder compensation. This has not been demonstrated. Track actual sales, collection, support hours, tool spend and churn before calling the business profitable.

## Payment and operational dependency

As of the research date, Kazakhstan is not on Stripe's official list of supported account countries. Do not make the MVP dependent on a live Stripe account or treat a Stripe test-mode result as a real payment. An eligible Kazakhstan-based business may investigate local providers such as IOKA, whose public site says it supports cards issued in 50+ countries, but merchant eligibility, payout terms, fees and the exact business category must be confirmed directly before relying on it.

Sources:
- https://stripe.com/global
- https://ioka.kz/en/products/accept-payments

## Go / no-go gates

- **Technical gate:** Core CI and new API tests pass on the PR head.
- **Data gate:** audit reports are reproducible on at least two real, redacted sample exports.
- **Value gate:** a buyer accepts the measured result and pays for an audit or pilot.
- **Economics gate:** delivery hours and costs leave a path to the target margin.
- **Scale gate:** at least three paying accounts renew or buy the next phase before attempting self-serve SaaS.

Until these gates pass, this is an MVP and a commercial experiment—not a guaranteed business, not a verified 78% success probability, and not yet a $1,000/week income stream.
