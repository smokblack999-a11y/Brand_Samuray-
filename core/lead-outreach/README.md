# SAMURAI Lead Outreach Module v1

Standalone, provider-neutral B2B prospecting and sales-follow-up module for SamuraiOS Core. It is deliberately separate from Telegram Business handling and can be mounted later as an optional router.

## Safety and current scope

- Apollo company/contact discovery through the official Apollo API using a server-side API key.
- Deterministic, explainable lead scoring; score is a heuristic, not a measured conversion probability.
- Local JSON persistence for MVP only; use a database adapter before multi-instance/production use.
- Draft generation and pipeline stage tracking.
- **No email sender is implemented.** No message is sent automatically. An email provider can be added behind the provider interface after credentials and permissions are verified.
- All API routes must be mounted behind SamuraiOS Core's existing `requireApiKey` middleware.
- Keep secrets in environment variables; never commit `.env`.

## Files

- `index.js` — public module API and optional Express router factory.
- `service.js` — discovery orchestration, scoring, deduplication and stage changes.
- `apollo.js` — Apollo API adapter.
- `store.js` — atomic JSON store for single-process development.
- `test/lead-outreach.test.js` — dependency-free tests.

## Environment

```env
LEAD_OUTREACH_ENABLED=false
APOLLO_API_KEY=
LEAD_OUTREACH_DATA_DIR=./data/lead-outreach
LEAD_OUTREACH_MAX_RESULTS=10
```

Keep `LEAD_OUTREACH_ENABLED=false` until you explicitly enable the module. Do not expose this router publicly without the Core API-key middleware and rate limits.

## Standalone use

```js
const { createLeadOutreach } = require("./lead-outreach");
const moduleInstance = createLeadOutreach({
  dataDir: process.env.LEAD_OUTREACH_DATA_DIR,
  apolloApiKey: process.env.APOLLO_API_KEY
});
const leads = await moduleInstance.discover({
  personTitles: ["Owner", "Founder", "Head of Operations"],
  industries: [],
  locations: ["United States"],
  limit: 10
});
```

Apollo search filters and available fields depend on the account/API plan. Verify actual results before treating an email as deliverable.

## Optional Express integration

```js
const { createLeadOutreachRouter } = require("./lead-outreach");
if (process.env.LEAD_OUTREACH_ENABLED === "true") {
  app.use("/api/lead-outreach", requireApiKey, createLeadOutreachRouter({
    dataDir: process.env.LEAD_OUTREACH_DATA_DIR,
    apolloApiKey: process.env.APOLLO_API_KEY
  }));
}
```

The host application is responsible for authentication, request rate limiting, CORS policy, HTTPS and production persistence. Router endpoints:
- `GET /leads` — list saved leads.
- `POST /discover` — search Apollo; requires explicit filters and limits results.
- `POST /leads/:id/draft` — create a draft only; never sends.
- `PATCH /leads/:id/stage` — change stage using the allowlist.

Example discovery request:
```json
{
  "personTitles": ["Founder", "Owner"],
  "locations": ["United States"],
  "industryTagIds": [],
  "limit": 10
}
```

## Integration contract

Lead object fields are stable and provider-neutral: `id`, `source`, `sourceId`, `company`, `name`, `title`, `email`, `website`, `location`, `score`, `scoreReasons`, `stage`, `draft`, `createdAt`, `updatedAt`.

Suggested next integrations:
1. Replace JSON store with existing SamuraiOS `store.js` / database repository adapter.
2. Emit a `lead.created` event for the existing orchestration layer.
3. Add a verified email adapter that supports draft/send separately, with explicit approval and audit log.
4. Connect Stripe payment state only through verified webhook events; never infer payment from email text.
