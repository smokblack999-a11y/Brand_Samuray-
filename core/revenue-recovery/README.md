# SAMURAI Revenue Recovery — Lead Leak Audit v1

## Single commercial wedge

**Offer:** identify inbound leads with no recorded first response or a response outside the client's SLA, then run a measured, human-approved recovery pilot. The first version audits an exported CRM/lead CSV; it does not require a live integration to produce the initial evidence.

**Best-fit customer hypothesis:** an agency, service company, or Telegram-led business with at least 50 inbound enquiries per month, high gross profit per sale, and timestamped lead/outcome data. Do not sell a revenue-lift promise to a business that cannot produce a usable baseline.

This is an offer hypothesis, not proof of market demand. The code can validate data quality and response gaps; it cannot create paying customers or guarantee recovered revenue.

## What exists in this branch

- Stateless, deterministic audit engine.
- CSV import with required column checks, duplicate-ID checks, timestamp validation and size/row limits.
- Authenticated Core endpoint: `POST /api/revenue-recovery/audit`.
- Optional scenario calculator that only uses explicit operator-supplied assumptions.
- Unit tests for metrics, edge cases and malformed CSV.
- No AI calls, no external provider calls, no outbound messaging, and no persistent storage in this module.

## API

The endpoint requires the existing `CORE_API_KEY` in `X-API-Key`. Requests are rate-limited using the Core lead limiter.

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
- Extra columns are ignored. Do not send message text, phone numbers, emails or other direct identifiers.

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

Initial pricing to test with prospects:

- **Lead-leak audit:** $250 fixed fee, credited to the pilot if the customer proceeds.
- **14-day pilot implementation:** $750, limited to one lead source, agreed definitions, weekly evidence review and human approval before any outbound message.
- **Managed monitoring after the pilot:** $300/week for a tightly capped scope, with tool/provider costs disclosed separately.

At five retained customers, $300/week each equals $1,500 weekly gross revenue. To produce $1,000/week in operating contribution, direct delivery/tool costs would have to remain at or below $500/week before tax and founder compensation. This arithmetic is a target model, not a forecast. Actual margins, sales conversion, churn, taxes and support time remain unmeasured.

A third-party agency pricing survey checked on 23 October 2026 reported published workflow prices of roughly $400–$5,000 and support retainers of $200–$2,000 per month; these are vendor-published examples, not a neutral market average: https://aistrikeforce.com/ai-automation-agency-pricing. Competitors already sell missed-call and lead-follow-up automation, so differentiation must come from a measured client-specific audit, clear economics, privacy, and a controlled implementation — not the claim that this category is undiscovered.

## Qualification and stop rules

Proceed only if the prospect:
1. has enough inbound volume to measure (starting qualification threshold: 50 leads/month);
2. can export pseudonymous lead IDs, creation timestamps, first-response timestamps and outcomes;
3. has a sufficiently valuable sale to justify a paid intervention;
4. agrees on baseline period, SLA, outcome definitions and handling of seasonality before the pilot;
5. approves any outreach content and channel before activation.

Stop or redesign if the customer cannot produce reliable timestamps, the measured response gap is small, expected economics are non-positive under the customer's own assumptions, or there is no willingness to pay for the diagnostic.

## Verification and limits

From `core/` run `npm test`. A passing unit test confirms the calculator and input validation, not production deployment, market demand, causal revenue lift, or a sale. The endpoint is only available after this branch is reviewed and merged into the Core codebase; this branch does not deploy itself.
