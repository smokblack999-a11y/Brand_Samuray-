# SAMURAI Computer Agent V1

Isolated Playwright worker prototype. It is deliberately separate from SamuraiOS Core and from X10THINK code-repair orchestration.

## Runtime firewall (Composio-inspired, locally enforced)

The worker applies a local policy layer on both sides of browser actions:
- Before click/fill: inspect the requested selector and the live element's visible text, accessible label, title, link, field name and type.
- Before navigation and for every intercepted browser request: require HTTPS, explicit host allowlist, DNS resolution, and public IP destinations only. Redirects and subresources are checked too.
- After page text, final URL and title are read: block common prompt-injection patterns and redact common token/credential patterns before returning content.
- Password, OTP, card, payment, gambling, transfer and destructive action indicators are blocked or require owner action.

The DNS/IP checks are defense in depth, not a complete SSRF boundary: the browser can resolve a hostname again after the check (DNS rebinding), and browser channels outside the intercepted request path may need separate controls. Production requires container/network-level egress filtering, isolated browser networking, and an E2E security test suite.

This implements the applicable runtime-firewall pattern described in Composio's documentation without requiring a Composio account or sending browser content to a third-party classifier. It is not the Composio product or a claim of equivalent detection quality.

## Current scope
- Authenticated task API.
- Playwright Chromium execution.
- Navigate, fill non-sensitive fields, click low-impact controls, and read page text.
- Per-job status and action journal in process memory.
- Action/result firewall, HTTPS host allowlist, DNS resolution and private/reserved IP rejection.

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
  "allowedHosts": ["accounts.example.org"],
  "intent": "Read public account help information",
  "steps": [
    {"action":"read","target":"h1"}
  ]
}
```

## Not production-ready
- Jobs are in-memory; no durable queue or persistent audit journal.
- No browser session vault/profile isolation or multi-tenant isolation.
- No Telegram notifications, retry policy, task planner, or robust postcondition verification.
- No deployed Railway service; Railway workspace currently has no projects and the prior trial requires plan selection.
- No end-to-end browser test against a real website.
- Host allowlisting and DNS/IP checks are not a complete SSRF defense; network-level egress policy is still required.
- Prompt-injection and secret detection are heuristic guardrails, not a complete security guarantee.
- No gambling/betting automation, payment execution, or all-balance wager loop.

## Run
```bash
npm install
npx playwright install chromium
npm test
npm start
```
