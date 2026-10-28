# SAMURAI Commerce — test deployment and acceptance runbook

Status: **test/staging only**. This document does not authorize production rollout or live payments.

## Scope and current limits

- Telegram Mini App endpoints are feature-gated and intended for Stripe test mode.
- `COMMERCE_MINIAPP_ENABLED=true` is accepted only when `NODE_ENV` is not `production` and `COMMERCE_MODE=test`.
- Stripe live keys and live-mode events are rejected by this implementation.
- SQLite supports one Core instance on a persistent local volume. Do not share the SQLite file across replicas or a network filesystem.
- The automated HTTP webhook integration test stubs outbound Stripe Checkout creation; it does not prove a real Stripe account, public DNS/TLS, Telegram launch configuration, or physical courier flow.

## 1. Prepare a test host

Requirements:
- Node.js 22.13+ (or Docker using the included `core/Dockerfile`).
- A stable HTTPS hostname with valid TLS.
- A persistent directory/volume for `DATA_DIR` and SQLite.
- A Telegram bot created with BotFather and a Stripe account with test mode enabled.

Never commit `.env`, API tokens, signing secrets, real customer data, database files, or webhook payloads containing personal information.

## 2. Configure the environment

Start from `core/.env.example`, then set real test credentials and replace all demo values. Required settings include:

- `NODE_ENV=staging` (do not use `production` for the test-only Mini App feature gate).
- `COMMERCE_MODE=test`
- `COMMERCE_MINIAPP_ENABLED=true`
- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...` from the webhook listener/endpoint actually used.
- `COMMERCE_SUCCESS_URL` and `COMMERCE_CANCEL_URL` to real HTTPS pages.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL`, and a strong `CORE_API_KEY`.
- Real `COMMERCE_PRODUCTS_JSON` and `COMMERCE_DELIVERY_ZONES_JSON`; do not leave the sample product in a customer-facing test.
- Numeric `COMMERCE_ADMIN_IDS` and `COMMERCE_COURIER_IDS`; configure distinct random courier tokens in `COMMERCE_COURIER_TOKENS_JSON` if courier media upload is tested.
- `DATA_DIR` and `COMMERCE_DB_PATH` pointing to persistent storage.

Generate random secrets rather than using the example values. Keep logs free of secret values.

Validate configuration before starting:

```bash
cd core
npm ci
npm run verify-commerce
npm test
```

The verifier is intentionally strict and exits non-zero when required configuration is missing or unsafe. Do not bypass it by deleting checks.

## 3. Build and start a single Core instance

Example Docker workflow (adapt the host path to your persistent disk):

```bash
mkdir -p ./samurai-data
chmod 700 ./samurai-data
docker build -t samurai-core:test ./core
docker run -d --name samurai-core-test \
  --restart unless-stopped \
  --env-file ./core/.env \
  -p 127.0.0.1:8787:8787 \
  -v "$PWD/samurai-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e COMMERCE_DB_PATH=/app/data/commerce.sqlite \
  samurai-core:test
```

Place a TLS reverse proxy in front of Core; do not expose the container port publicly without TLS and an explicit network policy. Ensure the reverse proxy forwards the Stripe webhook request body unchanged. Verify:

```bash
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8787/ready
```

The `/ready` endpoint checks Core's basic configured state; it does not prove Telegram, Stripe, or Mini App end-to-end functionality.

## 4. Verify the Telegram Mini App

1. Configure the Mini App URL in BotFather to the public HTTPS URL serving `/mini-app/`.
2. Launch it from the actual Telegram client, not a desktop browser with fabricated identity data.
3. Confirm the API sees real, signed Telegram `initData`; do not paste or log it into public issue trackers.
4. Confirm catalog loads, an order is created, and the client cannot override the customer ID or price.
5. Confirm one customer cannot read another customer's order.
6. Confirm a repeated order request with the same idempotency key does not create a second order.
7. Confirm checkout links are HTTPS and use `checkout.stripe.com` with a `cs_test_` session ID.

If any step is not observed against the deployed URL, record it as **not verified**.

## 5. Verify Stripe test payments

1. Use only Stripe test credentials and test payment methods.
2. Configure a Stripe test webhook endpoint for `POST /api/commerce/stripe/webhook` and copy the signing secret for that exact endpoint into `STRIPE_WEBHOOK_SECRET`.
3. Deliver a real Stripe test-mode Checkout event through the public HTTPS route.
4. Verify the signature is accepted, the exact order becomes `PAID`, and the currency/amount/session reference match.
5. Replay the same event and confirm it is deduplicated.
6. Send a tampered/invalid-signature request and confirm it is rejected.
7. Restart Core with the same persistent volume and confirm the order remains paid.

Never mark an order paid based on a browser redirect or a client-submitted status. The signed webhook is the payment evidence.

## 6. Verify restart and backup/restore

- Stop Core cleanly and restart it with the same persistent volume.
- Confirm order and payment state remain intact.
- Take a consistent SQLite backup using SQLite's backup facilities or a stopped/otherwise coordinated database copy; do not assume copying only the main database file while WAL is active is a valid backup.
- Restore into an isolated test directory and confirm the restored database opens and contains expected test records.
- Keep backup files private and set restrictive filesystem permissions.

## 7. Acceptance checklist

A release candidate is accepted for **limited test use only** when all are checked:

- [ ] Current commit's Core tests, Core X22 workflow, Docker build, and Android APK workflow pass.
- [ ] `npm run verify-commerce` passes against the intended test environment.
- [ ] Actual Telegram launch and signed `initData` are verified on a public HTTPS URL.
- [ ] Real Stripe **test-mode** Checkout completes and signed webhook reaches the deployed Core.
- [ ] Invalid signatures and mismatched amount/currency/session do not mark an order paid.
- [ ] Duplicate events are idempotent.
- [ ] SQLite restart and backup/restore checks pass.
- [ ] Courier/admin notification flow is verified using test accounts and test orders.
- [ ] Logs and screenshots contain no secrets or unnecessary personal data.

## 8. Production is a separate project gate

This branch is not production-ready merely because CI passes. Before any live commerce launch, the owner must explicitly approve a separate design/review covering production payment-mode support, deployment and rollback, observability, data retention/privacy, payment-provider eligibility, refunds/disputes, backups, incident response, and a controlled pilot. Do not switch to `NODE_ENV=production`, add live Stripe keys, or enable live payments as a workaround for the test-mode gate.
