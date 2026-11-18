# NEXUS live sandbox-evidence ingestion

This document covers the runtime prerequisites for PR #153. It is not a production deployment approval.

## Runtime image

Build from `core/Dockerfile`. The image installs the official GitHub CLI (`gh`) from GitHub's Debian package repository and verifies the downloaded keyring against the published SHA-256 before enabling that repository. The NEXUS importer uses `gh run view`, `gh run download` and `gh attestation verify`; a Node-only image is not sufficient.

## Required runtime configuration

Set these values in the deployment platform's secret/environment-variable manager. Do not commit real values to Git:

- `CORE_API_KEY`: existing Core API key (at least 16 characters).
- `TELEGRAM_WEBHOOK_SECRET`: existing Telegram webhook secret required by production startup.
- `AGENT_CONTROL_WEBHOOK_SECRET`: a separate, high-entropy secret for GitHub's `X-Hub-Signature-256` header. Do not reuse the Telegram secret.
- `GH_TOKEN`: a fine-grained token scoped to this repository with **Actions: read** and **Attestations: read**. Keep it server-side; never expose it to a browser, APK, workflow artifact, or log.
- `DATA_DIR`: persistent writable storage for Agent Control's job journal and Core data.
- `NEXUS_EVIDENCE_DIR`: persistent writable storage for imported receipts and patches.

For a platform with a mounted persistent volume at `/data`, a suitable layout is:

```dotenv
DATA_DIR=/data
NEXUS_EVIDENCE_DIR=/data/nexus-evidence
PORT=8787
```

The Core job journal and imported evidence must survive restarts. An ephemeral filesystem can lose pending job state or stored evidence and break later verification.

The service must be reachable from GitHub over HTTPS. Keep the admin API key in the secret manager; do not add it to the GitHub webhook.

## GitHub repository webhook

In the repository, open **Settings → Webhooks → Add webhook**:

1. Set the Payload URL to `https://<your-core-domain>/api/agent-control/github/webhook`.
2. Set Content type to `application/json`.
3. Set Secret to the exact value stored as `AGENT_CONTROL_WEBHOOK_SECRET`.
4. Choose **Let me select individual events**, then enable **Workflow runs**.
5. Save the webhook.

GitHub sends workflow-run events. Core accepts only the NEXUS sandbox workflow's completed, successful pull-request runs; unrelated, in-progress, failed, cancelled and duplicate events are ignored or rejected.

## Verification sequence

1. Confirm `GET /health` returns HTTP 200.
2. Confirm `GET /ready` returns HTTP 200 after the existing production secrets are configured.
3. Confirm the service process can execute `gh --version` and `gh auth status` without printing or exposing token values.
4. Trigger a real NEXUS sandbox run for a candidate job already in `SANDBOX_REQUIRED`.
5. In GitHub's webhook **Recent Deliveries**, verify the `workflow_run` delivery was sent and received an HTTP 200 or 202 response from Core.
6. Read the job through the authenticated Agent Control API and confirm it advanced to `CI_REQUIRED` only after artifact, receipt, digest, run-identity and Sigstore-attestation verification.

Do not test this flow by sending a fabricated `workflow_run` event or an unsigned request. The live test must use a real successful run and GitHub's signed delivery.

## Deployment boundary

PR #153 is based on PR #151, which is itself based on the earlier NEXUS sandbox work. Keep this branch as an isolated staging candidate until the full dependency chain has been reviewed. No merge, production deployment, public listener, GitHub webhook creation, or secret provisioning is authorized by this document.
