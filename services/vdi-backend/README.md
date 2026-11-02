# SAMURAI Kill Critic VDI — parking event audit backend

**Status:** isolated backend and read-only reconciliation endpoint. The service can accept synthetic/vendor events and detect several event-sequence inconsistencies. No customer feed, camera, license-plate model weights, or paid pilot is connected.

## What the product does
The first commercial product is an independent audit layer for an existing parking/ANPR system. It does not replace cameras, OCR, payment terminals, access control, or barriers.

It accepts events from an existing system, pseudonymizes the plate with HMAC, stores a masked plate and event metadata, then checks for:
- an exit without a previously recorded entry;
- an entry that remains without an exit beyond a configurable threshold;
- an entry/exit session with no recorded payment event;
- a second entry before the previous entry has a matching exit.

These are **review findings**, not proof of theft, fraud, non-payment, or a confirmed financial loss. Missing events in the feed can produce false alarms. A payment event means only that a payment event was recorded; the service does not verify settlement with a bank or payment provider.

## Run locally
Python 3.11 recommended.

```bash
cd services/vdi-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set VDI_API_KEY and PLATE_TOKEN_SECRET to long random values.
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

API docs: http://127.0.0.1:8090/docs
Health: `GET /health`, readiness: `GET /ready`.

## API
All endpoints except `/health` and `/ready` require `X-API-Key`.

- `POST /v1/events` — ingest one event. Supported event_type: `plate_observed`, `entry`, `exit`, `payment`.
- `GET /v1/events?limit=50` — recent privacy-minimized events.
- `GET /v1/audit/reconcile?stale_after_minutes=120` — read-only event reconciliation.
- `GET /v1/events/{event_id}` — event + observation decision.
- `GET /v1/decisions/{decision_id}` — stored decision.
- `GET /v1/proofs/{event_id}` — hash-chained proof receipt.
- `GET /v1/proof-chain/verify` — verifies local receipt links and hashes.
- `GET /v1/metrics` — event counters.

## Synthetic event example
Send a payment event with an ISO-8601 timezone-aware timestamp and amount in minor currency units (tiyn for KZT).

```bash
curl -X POST http://127.0.0.1:8090/v1/events \
  -H 'Content-Type: application/json' -H 'X-API-Key: dev-change-me' \
  -d '{"source_id":"parking-demo","event_id":"demo-payment-1","event_type":"payment","occurred_at":"2026-11-02T10:30:00+05:00","plate_text":"123ABC01","ocr_confidence":0.99,"amount_minor":150000,"currency":"KZT"}'
curl -H 'X-API-Key: dev-change-me' \
  'http://127.0.0.1:8090/v1/audit/reconcile?stale_after_minutes=120'
```

Use synthetic data only until a customer authorizes a real integration. `amount_minor` is recorded as supplied; it is not independently verified.

## RTSP mode
RTSP is optional and disabled by default. To enable it:
1. Obtain written permission to process the camera feed.
2. Supply a YOLO model trained to detect license plates (not generic COCO weights).
3. Set `ENABLE_RTSP=true`, `RTSP_URL`, and `YOLO_MODEL_PATH`.
4. Keep RTSP credentials in secrets, never in Git.
5. Start with a controlled test feed.

The current RTSP worker emits `plate_observed` events. It does not infer entry/exit/payment events by itself. For the commercial audit, those event types must come from the existing parking/access/payment system or a separately validated direction/session adapter.

## Privacy and security
- Raw plate text is not persisted or returned. A keyed HMAC token and masked value are stored.
- HMAC tokens remain potentially linkable personal data; define a lawful purpose, notice, access controls, and retention before processing real plates.
- One shared API key is used in this pilot scaffold. Production requires per-customer/per-source credentials, RBAC, TLS, rate limits, key rotation, and secret management.
- SQLite is suitable for a single-node pilot, not distributed multi-writer production.
- Proof hashes are tamper-evident within the local chain, not an external immutable ledger or trusted timestamp.
- Configure retention/deletion and customer authorization before real deployment.

## Important limits
- Kazakhstan plate validation currently covers only one standard private-vehicle pattern. It is not a complete legal plate registry.
- Plate-format validity does not prove vehicle identity, ownership, authorization, payment, or a right to enter.
- Findings are leads for human review. No automated barrier actuation, payment capture, access denial, or accusation is implemented.
- No real camera/model/customer integration or paid pilot has been validated yet.
