# CI-AGENT setup and verification

CI-AGENT receives signed GitHub Actions workflow-run events, queues bounded background analysis, fetches failed job logs, redacts common credential patterns, and produces an AI-assisted diagnosis for a human to review. Kill Critic findings are attached for review; they do not authorize code changes. It does **not** modify repository files, create commits, rerun workflows, deploy, or mark failures as fixed.

## Required environment

Set these on the SamuraiOS Core service:

- `GITHUB_WEBHOOK_SECRET`: a long random secret shared with the GitHub webhook.
- `GITHUB_TOKEN`: a fine-grained GitHub token with **Actions: read-only** access to the repository. Needed only for automatic log retrieval.
- `CORE_API_KEY`: existing SamuraiOS API key protecting administrative endpoints.
- `OPENAI_API_KEY`: required only for AI diagnosis.
- `CI_AGENT_MODEL`: model ID supported by this OpenAI account; overrides `OPENAI_MODEL`. At least one of these must be set for analysis. The service deliberately has no guessed default model.
- `OPENAI_TIMEOUT_MS`: existing OpenAI timeout setting.
- `CI_AGENT_STATE_FILE`: optional path for the durable JSON state file; defaults to `DATA_DIR/ci-agent-state.json` (or `core/data/ci-agent-state.json`). Keep it on a persistent writable volume and restrict filesystem access.

Do not commit real values to the repository.

## Configure the GitHub webhook

In the repository's **Settings → Webhooks**, add the deployed endpoint:

`https://YOUR-DOMAIN/api/github/webhook`

Set the same secret as `GITHUB_WEBHOOK_SECRET`, select **application/json**, and subscribe to **Workflow runs**. GitHub sends the event; the service verifies `X-Hub-Signature-256` against the raw request body. Only completed runs whose conclusion is `failure` or `timed_out` are recorded.

## API

List recent recorded failure events:

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

The webhook now queues analysis in the background and returns promptly. Check `GET /api/ci/events?limit=20` for each event's `analysis.status`: `queued`, `running`, `retrying`, `suggestion_only`, `failed`, or `queue_full`. The in-process queue holds at most 50 waiting events and makes at most two attempts per event. Event metadata, delivery deduplication IDs, queue status, and analysis results are saved atomically to the state file; queued work is recovered after restart where retry budget remains. The queue still runs in one process only. The `suggestion_only` result is not a fix and never changes repository files. Kill Critic is run against the generated suggestion and its decision/findings are recorded for human review. The protected `/analyze-auto` endpoint remains available for manual retry/inspection.

## Current limitations

- The file-backed store uses atomic rename and restrictive file permissions, but is not a distributed queue or database. It supports a single service process on a durable writable filesystem; do not run multiple replicas against the same file. For multi-replica deployment, use a transactional shared database/queue. Back up and protect the state file because it contains workflow metadata and generated suggestions.
- Automatic log retrieval uses the GitHub Actions Jobs API and requires `GITHUB_TOKEN` with Actions read-only access. It inspects up to 10 failed/timed-out/cancelled jobs, limits the downloaded archive to 10 MB and extracted log text to 12,000 characters. GitHub log archives are temporary and are not stored by this service.
- Log input is bounded and common credentials are redacted before analysis, but this cannot guarantee removal of every secret or personal datum. Review repository logs and data-handling policy before sending logs to an external AI provider.
- A valid webhook signature authenticates the sender that knows the configured secret; use a unique, high-entropy secret and keep it private.
- No automatic repository writes, commits, merges, or reruns are performed.
