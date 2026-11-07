# SamuraiOS Core — Staging Runbook

This runbook is for a **staging-only, single-instance** deployment. Do not use it to deploy production or merge the staging branch.

## 1. Required configuration

Create `core/.env` on the staging host. Do not commit it and do not send its contents in chat.

```dotenv
NODE_ENV=production
PORT=8787
DATA_DIR=/app/data
CORE_API_KEY=<generate-a-unique-secret>
GITHUB_WEBHOOK_SECRET=<generate-a-different-unique-secret>
TELEGRAM_WEBHOOK_SECRET=
AUTO_REPLY=false
```

Generate secrets locally on the host:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Use the first value only for `CORE_API_KEY`, and the second only for `GITHUB_WEBHOOK_SECRET`. Keep `TELEGRAM_WEBHOOK_SECRET` empty unless Telegram is being configured separately. Protect the file:

```bash
chmod 600 core/.env
```

The GitHub Actions secret `GITHUB_WEBHOOK_SECRET` must exactly match the Core server's `GITHUB_WEBHOOK_SECRET` (or `AGENT_CONTROL_WEBHOOK_SECRET`). Never print either value in logs.

## 2. Build and start one staging instance

Run from the repository root on the staging host:

```bash
docker volume create samurai-core-staging-data
docker build -t samurai-core:staging ./core
docker run -d \
  --name samurai-core-staging \
  --restart unless-stopped \
  --env-file core/.env \
  -p 127.0.0.1:8787:8787 \
  -v samurai-core-staging-data:/app/data \
  samurai-core:staging
```

Bind only to loopback. Put a TLS reverse proxy or managed HTTPS ingress in front of this port. Do not expose port 8787 directly to the public internet. Keep exactly one Core replica: the JSON/JSONL stores do not implement distributed locking.

## 3. Verify Core and authentication

```bash
set -a
. core/.env
set +a
curl -i http://127.0.0.1:8787/health
curl -i http://127.0.0.1:8787/ready
curl -i http://127.0.0.1:8787/api/stats
curl -i -H "X-API-Key: $CORE_API_KEY" http://127.0.0.1:8787/api/stats
curl -i -H "X-API-Key: $CORE_API_KEY" http://127.0.0.1:8787/ready/telegram
```

Expected:
- `/health`: HTTP 200.
- `/ready`: HTTP 200 when Core storage is readable and the API key is configured.
- `/api/stats` without the key: HTTP 401.
- `/api/stats` with the key: HTTP 200.
- `/ready/telegram`: HTTP 503 while Telegram secret is intentionally unset; this does not mean Core itself is unready.

Do not place the API key in a shared terminal transcript or public CI log.

## 4. Connect GitHub Actions webhook

After HTTPS ingress is live, set these GitHub Actions repository secrets:

- `X10THINK_RECOVERY_URL`: the public HTTPS base URL, without a trailing slash.
- `GITHUB_WEBHOOK_SECRET`: the same secret as the Core server's webhook secret.

Settings page: https://github.com/smokblack999-a11y/Brand_Samuray-/settings/secrets/actions

The workflow appends `/api/agent-control/github/webhook` to the base URL. Confirm that the GitHub webhook is delivered successfully, that an identical delivery is treated as a duplicate, and that an invalid signature receives HTTP 401. Do not enable the workflow against a server until HTTPS and the secret have both been configured.

## 5. Persistence and recovery acceptance checks

1. Trigger a test `workflow_run` event and confirm one job appears in `/api/agent-control/jobs`.
2. Send the same delivery again and confirm it is marked duplicate; job count must not increase.
3. Restart the container: `docker restart samurai-core-staging`.
4. Confirm the same job remains after restart.
5. Confirm the named volume remains attached and the queue file is under `/app/data`.
6. Confirm data directory permissions are `0700` and persisted data files are `0600` on the Linux host/container.
7. Take a volume backup and perform a restore test before any production decision.

## 6. Stop / rollback

```bash
docker logs --tail 200 samurai-core-staging
docker stop samurai-core-staging
docker rm samurai-core-staging
```

Do not delete `samurai-core-staging-data` during rollback. Preserve it for investigation and recovery.

## Current status

This document is an execution guide, not evidence of a live deployment. As of this branch, no public HTTPS endpoint, hosting service, DNS record, GitHub Actions secret, or production instance has been configured. Complete the checks above on a staging host and record the actual outputs before considering production.
