# CI-AGENT setup and verification

CI-AGENT receives signed GitHub Actions workflow-run events and produces an AI-assisted diagnosis for a human to review. It does **not** modify repository files, create commits, rerun workflows, or mark failures as fixed.

## Required environment

Set these on the SamuraiOS Core service:

- `GITHUB_WEBHOOK_SECRET`: a long random secret shared with the GitHub webhook.
- `CORE_API_KEY`: existing SamuraiOS API key protecting administrative endpoints.
- `OPENAI_API_KEY`: required only for AI diagnosis.
- `CI_AGENT_MODEL`: optional; overrides `OPENAI_MODEL` for CI diagnosis.
- `OPENAI_TIMEOUT_MS`: existing OpenAI timeout setting.

Do not commit real values to the repository.

## Configure the GitHub webhook

In the repository's **Settings → Webhooks**, add the deployed endpoint:

`https://YOUR-DOMAIN/api/github/webhook`

Set the same secret as `GITHUB_WEBHOOK_SECRET`, select **application/json**, and subscribe to **Workflow runs**. GitHub sends the event; the service verifies `X-Hub-Signature-256` against the raw request body. Only completed runs whose conclusion is `failure` or `timed_out` are recorded.

## API

List recent in-memory failure events:

```sh
curl -fsS 'https://YOUR-DOMAIN/api/ci/events?limit=20' \
  -H 'X-API-Key: YOUR_CORE_API_KEY'
```

Analyze a known event by supplying relevant logs (maximum 12,000 characters):

```sh
curl -fsS -X POST 'https://YOUR-DOMAIN/api/ci/events/RUN_ID/analyze' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_CORE_API_KEY' \
  --data-binary @- <<'JSON'
{
  "logs": "Paste the relevant failed-step log excerpt here."
}
JSON
```

The response status is `suggestion_only`. Review the diagnosis and proposed patch before changing code.

## Current limitations

- Events are held in process memory and disappear on restart; multiple replicas do not share event state.
- The service records workflow metadata but does **not** fetch job logs automatically. A caller must supply the log excerpt to the analysis endpoint.
- Log input is bounded, but callers should remove credentials, personal data, and other secrets before submitting logs to an external AI provider.
- A valid webhook signature authenticates the sender that knows the configured secret; use a unique, high-entropy secret and keep it private.
- No automatic repository writes, commits, merges, or reruns are performed.
