# SAMURAI Computer Agent V1

Isolated Playwright worker prototype. It is deliberately separate from SamuraiOS Core and from X10THINK code-repair orchestration.

## Current scope
- Authenticated HTTPS task API.
- Playwright Chromium execution.
- Navigate, fill non-sensitive fields, click low-impact controls, and read page text.
- Per-job status and action journal in process memory.
- Safety policy rejects password/OTP fields and betting, wagering, payment, withdrawal, and other high-impact click targets.

## API
- `GET /health`
- `POST /v1/jobs` with `X-API-Key`
- `GET /v1/jobs/:id` with `X-API-Key`

Required environment:
- `COMPUTER_AGENT_API_KEY`
- `PORT` (default 8790)

Example request:
```json
{
  "url": "https://example.com",
  "steps": [
    {"action":"read","target":"h1"}
  ]
}
```

## Not production-ready
This first slice is not yet a durable or isolated production executor: jobs are in-memory, there is no persistent queue, no browser profile/session vault, no Telegram notification, no retry engine, no multi-tenant isolation, and no end-to-end deployment test. Do not expose it publicly or use real credentials until those controls and tests are implemented.

Run:
```bash
npm install
npx playwright install chromium
npm test
npm start
```
