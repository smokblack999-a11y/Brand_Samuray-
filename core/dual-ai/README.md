# SAMURAI Dual AI

Dual-agent orchestration module for SAMURAI Core.

## Runtime flow

1. Model A analyses the task and proposes a candidate.
2. Model B (Kill Critic) evaluates the candidate against the original task.
3. On FAIL, Model A receives the structured critique and produces a revision.
4. The cycle repeats up to `DUAL_AI_MAX_ROUNDS` (default 3, hard maximum 5).
5. A final answer is exposed only when Kill Critic returns PASS. Exhausting the round limit ends in BLOCKED with no approved final answer.

## Quality gate

The critic returns confidence, requirement coverage, factuality, reasoning quality and safety scores, plus issues, required changes and evidence gaps.

PASS requires:
- every score >= 0.85;
- no issues;
- no required changes;
- no evidence gaps;
- valid structured critic output.

Malformed or incomplete critic output fails closed. A PASS is an automated model assessment, not a guarantee of truth. The Evidence Verifier applies a separate fail-closed policy: coding/build tasks require server-origin test/build proof; deployment claims require execution proof; current or time-sensitive claims require source proof; high-impact medical/legal/financial topics require domain-review proof. Model-generated statements and user-supplied text are never accepted as proof. If proof is absent, the candidate remains visible as `CONDITIONAL` and is not exposed as an approved `final`. Proof records must carry an HMAC signature created with the server-only `EVIDENCE_SIGNING_KEY` (minimum 32 characters); unsigned or user/model-supplied records fail validation. The current version defines and tests the signed proof contract; trusted runners/adapters that produce these records are a separate integration step.

## Providers

Supported server-side providers:
- `openai` — `OPENAI_API_KEY`
- `anthropic` — `ANTHROPIC_API_KEY`
- `ollama` — `OLLAMA_BASE_URL` (defaults to `http://127.0.0.1:11434`)

Optional role configuration:
- `DUAL_AI_A_PROVIDER`, `DUAL_AI_A_MODEL`
- `DUAL_AI_B_PROVIDER`, `DUAL_AI_B_MODEL`
- `DUAL_AI_MAX_ROUNDS`
- `DUAL_AI_TIMEOUT_MS`
- `EVIDENCE_SIGNING_KEY` — server-only random key, at least 32 characters, required to sign and verify evidence receipts

Use different model families for A and B when possible to reduce correlated blind spots. The API key remains on the Core server; the browser only sends the existing Core `X-API-Key` for authorization.

## API

The UI is served at `/dual-ai/`. It uses existing protected endpoints:
- `GET /api/dual-ai/config`
- `GET /api/dual-ai/sessions`
- `GET /api/dual-ai/session/:id`
- `GET /api/execution-verifier/status` — protected runner status
- `POST /api/execution-verifier/core-tests` — run the fixed Core test profile (one run per minute)
- `POST /api/dual-ai/session`
- `POST /api/dual-ai/turn`
- `POST /api/dual-ai/stop`

All API routes continue to use the existing `requireApiKey` middleware and rate limiter. Session data is stored through the existing Dual AI store.

## Validation

Run from `core/`:

```sh
npm test
```

A live provider test requires valid server-side credentials and a reachable provider. Ollama must be running separately. The module does not silently fabricate responses when a provider is unavailable.
