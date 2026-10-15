# SAMURAI Revenue Pilot

This package tests unit economics for a narrow Telegram Business lead-assistant pilot. It does not promise increased revenue.

## Offer hypothesis

- 14-day paid setup pilot: test price USD 300.
- Optional service after the pilot: test price USD 149/month.
- Scope: one Telegram Business connection, text-only inquiries, lead classification, draft replies based on client-approved facts, human approval, and a basic results report.
- These prices are hypotheses to validate, not market averages.

## API

The authenticated endpoint is `POST /api/revenue-pilot/evaluate`. It uses the existing `CORE_API_KEY` authentication and rate limiter. Send the `X-API-Key` header and JSON body:

```json
{
  "currency": "USD",
  "baseline": {
    "monthlyLeads": 100,
    "qualifiedLeadRatePct": 20,
    "closeRatePct": 10,
    "adminHoursPerMonth": 20
  },
  "pilot": {
    "monthlyLeads": 100,
    "qualifiedLeadRatePct": 25,
    "closeRatePct": 12,
    "adminHoursPerMonth": 12
  },
  "grossProfitPerSale": 400,
  "monthlyServiceFee": 149,
  "oneTimeSetupFee": 300,
  "monthlyOperatingCost": 20,
  "adminHourlyCost": 20,
  "evidenceWindowDays": 14
}
```

The figures are illustrative test data only. Replace them with client-provided figures before interpreting a result.

## Before accepting a client

1. Screen for recurring Telegram text inquiries; an initial target is 40+ per month so the pilot can produce enough observations.
2. Record a comparable baseline: inquiries, qualified inquiries, response time, booked meetings or sales if available, and staff hours.
3. Agree in writing on what counts as a qualified lead and which messages are excluded.
4. Obtain permission to process messages, minimize personal data, and set a deletion period.
5. Keep automatic sending disabled until the client explicitly approves a tested policy.
6. Agree on scope, fee, third-party API and hosting costs, message limits, and support boundaries.

## Interpretation limits

- Inputs are not independently verified.
- Before/after differences do not prove the assistant caused a change.
- Sales are fractional expected values, not guaranteed actual sales.
- Annotate seasonality, promotions, staffing and traffic changes before making ROI claims.

## Local verification

From `core/`, run:

```sh
npm test
```

The unit test checks calculator behavior only. It does not prove market demand, production reliability, or the truth of customer-supplied metrics.
