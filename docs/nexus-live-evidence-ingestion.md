# NEXUS live sandbox-evidence ingestion

This is the deployment runbook for PR #153. It does not approve production rollout.

## Use the repository-root Dockerfile

For NEXUS auto-ingestion, build the repository-root `Dockerfile` with the repository root as the build context:

```bash
docker build --pull -t samurai-core-runtime .
```

Do not use `core/Dockerfile` for this feature: that image is the legacy Core image and does not contain GitHub CLI. The root image installs the official `gh` package, checks the published keyring SHA-256, and verifies that `gh` exists during the image build. CI repeats that build and checks the runtime binary.

The image build must not receive `GH_TOKEN`; provide it only as a runtime secret.

## Required runtime configuration

Set values in the deployment platform's secret manager. Never commit real values:

- `CORE_API_KEY`: existing Core API key.
- `TELEGRAM_WEBHOOK_SECRET`: existing Telegram webhook secret required by production startup.
- `AGENT_CONTROL_WEBHOOK_SECRET`: separate high-entropy secret for GitHub's `X-Hub-Signature-256`. Do not reuse the Telegram secret.
- `GH_TOKEN`: fine-grained token scoped to this repository with **Actions: read** and **Attestations: read** permissions.
- `DATA_DIR`: persistent writable storage for the Agent Control journal and Core data.
- `NEXUS_EVIDENCE_DIR`: persistent writable storage for imported receipts and patches.
- `PORT`: `8787`, unless the deployment platform supplies its own port.

Example for a persistent volume mounted at `/data`:

```dotenv
DATA_DIR=/data
NEXUS_EVIDENCE_DIR=/data/nexus-evidence
PORT=8787
```

The job journal and imported evidence must survive restarts. Do not use an ephemeral filesystem for these paths. Keep `GH_TOKEN`, `CORE_API_KEY`, and webhook secrets server-side; never expose them to a browser, APK, workflow artifact, or log.

The Core service must be reachable from GitHub over HTTPS.

## Configure the GitHub repository webhook

In GitHub, open **Repository → Settings → Webhooks → Add webhook**:

1. Payload URL: `https://<your-core-domain>/api/agent-control/github/webhook`.
2. Content type: `application/json`.
3. Secret: the exact value stored in `AGENT_CONTROL_WEBHOOK_SECRET`.
4. Select **Let me select individual events**, then enable **Workflow runs**.
5. Save the webhook.

Do not put `CORE_API_KEY` in the webhook configuration. The endpoint validates GitHub's HMAC signature.

## Live verification

1. Check `GET /health` returns HTTP 200.
2. Check `GET /ready` returns HTTP 200 after production secrets are configured.
3. Inside the running service, verify `gh --version` and `gh auth status`; never print the token value.
4. Create or advance a real Agent Control job to `SANDBOX_REQUIRED`.
5. Complete a real NEXUS sandbox workflow run for the exact repository/base SHA/head SHA.
6. In GitHub webhook **Recent Deliveries**, verify the signed `workflow_run` event received HTTP 200 or 202 from Core.
7. Read the authenticated job endpoint and confirm it advanced to `CI_REQUIRED` only after the artifact, receipt, digests, run identity and Sigstore attestation were verified.

Do not send fabricated or unsigned workflow events to simulate success.

## Rollout boundary

PR #153 depends on PR #151 and the earlier NEXUS sandbox chain. Keep the candidate branch isolated until the whole dependency chain is reviewed. This runbook does not authorize merging, creating a public listener, deploying production, creating a repository webhook, or provisioning secrets.
