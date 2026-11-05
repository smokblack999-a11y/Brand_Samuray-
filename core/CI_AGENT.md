# CI-AGENT setup and verification

CI-AGENT receives signed GitHub Actions workflow-run events and produces an AI-assisted diagnosis for a human to review. It does **not** modify repository files, create commits, rerun workflows, or mark failures as fixed.

## Required environment

Set these on the SamuraiOS Core service:

- `GITHUB_WEBHOOK_SECRET`: a long random secret shared with the GitHub webhook.
- `GITHUB_TOKEN`: a fine-grained GitHub token with **Actions: read-only** access to the repository. Needed only for automatic log retrieval.
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

Automatically fetch logs for a known failed run and analyze them (requires `GITHUB_TOKEN`):

```sh
curl -fsS -X POST 'https://YOUR-DOMAIN/api/ci/events/RUN_ID/analyze-auto' \\
  -H 'X-API-Key: YOUR_CORE_API_KEY'
```

For manual analysis, you can still supply relevant logs (maximum 12,000 characters):

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
- Automatic log retrieval uses the GitHub Actions Jobs API and requires `GITHUB_TOKEN` with Actions read-only access. It inspects up to 10 failed/timed-out/cancelled jobs, limits the downloaded archive to 10 MB and extracted log text to 12,000 characters. GitHub log archives are temporary and are not stored by this service.
- Log input is bounded, but logs can still contain secrets or personal data. Review your repository's log output and access policy before sending logs to an external AI provider; automatic retrieval does not guarantee secret redaction.
- A valid webhook signature authenticates the sender that knows the configured secret; use a unique, high-entropy secret and keep it private.
- No automatic repository writes, commits, merges, or reruns are performed.
