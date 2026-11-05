# X10THINK Agent Control Plane — GitHub Actions setup

The `X10THINK Agent Control Plane` workflow forwards completed CI/APK workflow events to the deployed SamuraiOS Core endpoint. It signs the exact JSON payload with HMAC-SHA256. The receiver verifies the signature before accepting the event.

## Required repository Actions secrets

Open the repository on GitHub, then go to **Settings → Secrets and variables → Actions → New repository secret**.

1. `X10THINK_RECOVERY_URL`: the **base URL** of the deployed SamuraiOS Core service, for example `https://core.example.com`. Do not include the API path. The workflow appends `/api/agent-control/github/webhook`.
2. `GITHUB_WEBHOOK_SECRET`: a long, random secret value used only for signing this webhook. Do not commit it, paste it into an issue, or send it in chat.

The receiver must have the **same secret value** in its environment as either `AGENT_CONTROL_WEBHOOK_SECRET` or `GITHUB_WEBHOOK_SECRET`. Configure it in the hosting provider's environment settings, then redeploy/restart the service. The workflow secret and receiver secret must match byte-for-byte.

## Verify the receiver

- Confirm `GET /health` responds from the deployed service.
- Confirm the deployed build contains `POST /api/agent-control/github/webhook`.
- Confirm the service is reachable from GitHub-hosted runners over HTTPS.
- Do not use `CORE_API_KEY` or `TELEGRAM_WEBHOOK_SECRET` as the agent-control signing secret.

## Run and verify

After both secrets and the receiver environment are configured, open **Actions → X10THINK Agent Control Plane → Run workflow** if manual dispatch is available, or trigger one of the watched workflows. Inspect the `Route signed workflow event` step.

Expected result: an HTTP 2xx response from the receiver. A missing secret fails with an explicit error; an unreachable endpoint or non-2xx receiver response also fails. A successful delivery only proves event ingestion—not autonomous repair, sandbox proof, or a successful end-to-end production recovery.

## Security properties

- Secret values are never printed by the workflow.
- The receiver must verify `X-Hub-Signature-256` over the raw request body.
- Keep automatic writes and merges disabled until diagnosis, reproduction, sandbox, CI, and proof gates are independently verified.
