# SAMURAI Revenue Recovery — Lead Leak Audit v1

## Single commercial wedge

**Offer:** identify inbound leads with no recorded first response or a response outside the client's SLA, then run a measured, human-approved recovery pilot. The first version audits an exported CRM/lead CSV; it does not require a live integration to produce the initial evidence.

**Best-fit customer hypothesis:** HVAC / climate installation, repair and maintenance companies in Almaty and Astana, with multiple field teams, roughly 30+ inbound enquiries per month, and timestamped lead/outcome data. Plumbing/heating and electrical contractors are secondary cohorts. Do not sell a revenue-lift promise to a business that cannot produce a usable baseline.

This is an offer hypothesis, not proof of market demand. The code can validate data quality and response gaps; it cannot create paying customers or guarantee recovered revenue.

## What exists in this branch

- Stateless, deterministic audit engine.
- CSV import with an exact four-column allowlist, duplicate-ID checks, timestamp validation and size/row limits.
- Authenticated Core endpoint: `POST /api/revenue-recovery/audit`.
- Optional scenario calculator that only uses explicit operator-supplied assumptions.
- Unit tests for metrics, edge cases and malformed CSV.
- No AI calls, no external provider calls, no outbound messaging, and no persistent storage in this module.

## API

The endpoint requires the existing `CORE_API_KEY` in `X-API-Key`. Requests are authenticated before JSON body parsing and rate-limited using the Core lead limiter. Malformed JSON and oversized request bodies receive structured errors with a request ID.

### CSV request

Required CSV headers:

```csv
lead_id,created_at,first_response_at,outcome
L-001,2026-10-01T09:00:00Z,2026-10-01T09:03:00Z,won
L-002,2026-10-01T09:00:00Z,2026-10-01T09:17:00Z,open
L-003,2026-10-01T09:00:00Z,,lost
```

- `lead_id`: pseudonymous unique identifier; do not use a customer's name or email.
- `created_at`: ISO-8601 timestamp with explicit timezone.
- `first_response_at`: same format; blank means no response timestamp was recorded.
- `outcome`: exactly `open`, `won`, or `lost`.
- `currency`: an uppercase three-letter display code; this version validates its shape but does not verify membership in ISO 4217. Confirm the code with the client before presenting monetary figures.
- Extra columns are rejected. Remove every unused column before transfer; do not send message text, phone numbers, emails or other direct identifiers.
- Group win rate is calculated only over closed outcomes (`won` + `lost`); open leads are reported separately and excluded from the denominator.
- SLA timing currently uses elapsed clock minutes, not business hours or a holiday calendar.

Example:

```sh
curl -X POST "$CORE_URL/api/revenue-recovery/audit" \
  -H "X-API-Key: $CORE_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{
  "currency": "USD",
  "slaMinutes": 5,
  "csv": "lead_id,created_at,first_response_at,outcome\nL-001,2026-10-01T09:00:00Z,2026-10-01T09:03:00Z,won\nL-002,2026-10-01T09:00:00Z,,open"
}
JSON
```

JSON-array mode is also available by sending `leads` with objects containing `id`, `createdAt`, `firstResponseAt` (or null), and `outcome`.

### Optional scenario assumptions

Include this object only when preparing a clearly labelled illustration:

```json
{
  "grossProfitPerWin": 500,
  "recoveryRatePct": 10,
  "pilotFee": 750,
  "operatingCost": 50,
  "measurementDays": 14
}
```

The response labels the output as an *illustrative scenario*, not a forecast. Recovery rate is supplied by the operator and must not be presented as an observed conversion rate unless historical evidence actually supports it. Missing timestamps are a data-quality signal, not proof that nobody contacted the lead.

## Commercial test — hypotheses, not guarantees

Initial Kazakhstan pricing hypotheses:

- **Lead-response audit:** 49,000 ₸ fixed fee for one pseudonymized export.
- **14-day human-operated follow-up pilot:** scoped and priced separately after the audit confirms a real workflow gap.
- **Recurring monitoring:** 39,900–59,900 ₸/month as a hypothesis for repeat audits, overdue follow-up visibility and recovery tracking.

These are test prices, not market averages or validated willingness-to-pay. CRM integration, WhatsApp Business Platform integration, custom workflow work and automated messaging are separate scope. The first audit does not send messages or write to the customer's CRM.

## Qualification and stop rules

Proceed only if the prospect:
1. has enough inbound volume to measure (starting qualification threshold: approximately 30 leads/month for the HVAC experiment);
2. can export pseudonymous lead IDs, creation timestamps, first-response timestamps and outcomes;
3. has a sufficiently valuable sale to justify a paid intervention;
4. agrees on baseline period, SLA, outcome definitions and handling of seasonality before the pilot;
5. approves any outreach content and channel before activation.

Stop or redesign if the customer cannot produce reliable timestamps, the measured response gap is small, expected economics are non-positive under the customer's own assumptions, or there is no willingness to pay for the diagnostic.

## Verification and limits

From `core/` run `npm test`. A passing unit test confirms the calculator and input validation, not production deployment, market demand, causal revenue lift, or a sale. The endpoint is only available after this branch is reviewed and merged into the Core codebase; this branch does not deploy itself.
