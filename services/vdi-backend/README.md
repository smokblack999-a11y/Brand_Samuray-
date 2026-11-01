# SAMURAI VDI Backend — RTSP → YOLO → OCR → KZ Validator → SQLite → API

**Status:** isolated runnable backend scaffold. No camera, weights, or customer feed are bundled. RTSP inference requires a compatible license-plate YOLO weights file supplied by the operator.

## Architecture
RTSP/OpenCV worker → YOLO plate detector → EasyOCR → Kazakhstan standard plate-format validator → privacy-preserving event store → FastAPI.

The service validates plate *format only*. It does not establish vehicle identity, ownership, authorization, payment, or a right to enter. It never controls a barrier. OCR/format uncertainty is REVIEW.

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

## Test without a camera
```bash
export VDI_API_KEY=dev-change-me
export PLATE_TOKEN_SECRET=dev-change-me-too
curl -X POST http://127.0.0.1:8090/v1/events \
  -H 'Content-Type: application/json' -H 'X-API-Key: dev-change-me' \
  -d '{"source_id":"manual-test","event_id":"evt-001","event_type":"plate_observed","occurred_at":"2026-11-01T12:00:00Z","plate_text":"123ABC01","ocr_confidence":0.98}'
curl -H 'X-API-Key: dev-change-me' http://127.0.0.1:8090/v1/events
```

The sample plate is synthetic. Use UTC ISO-8601 timestamps.

## RTSP mode
1. Obtain written permission to process the camera feed.
2. Supply a YOLO model trained to detect license plates (not generic COCO `yolov8n.pt`). The model's detected class is configurable.
3. Set `ENABLE_RTSP=true`, `RTSP_URL`, and `YOLO_MODEL_PATH=/models/license-plate.pt`.
4. Mount weights into the container at that path. Keep RTSP credentials in secrets, never in Git.
5. Start with a controlled test feed. RTSP processing is read-only; no actuator integration exists.

Example:
```bash
docker compose up --build
```

## Environment
- `VDI_API_KEY`: required API key; all write/read API routes require it.
- `PLATE_TOKEN_SECRET`: required HMAC secret used to pseudonymize plate text.
- `DATABASE_PATH`: SQLite path (default `./data/vdi.sqlite3`).
- `ENABLE_RTSP`: default false.
- `RTSP_URL`: camera stream URL (do not commit credentials).
- `YOLO_MODEL_PATH`: custom license-plate detector weights.
- `YOLO_CLASS_ID`: optional class id; unset accepts all model classes.
- `OCR_LANGUAGES`: EasyOCR language list, default `en`.
- `MIN_OCR_CONFIDENCE`: default 0.70.
- `FRAME_INTERVAL_SECONDS`: default 1.0.
- `CAMERA_ID`: source id for RTSP events.

- `GET /v1/proof-chain/verify` — verifies every local proof-chain link and receipt hash.\n\n## API
- `GET /health` — liveness.
- `GET /ready` — DB/config/model readiness.
- `POST /v1/events` — authenticated manual/vendor event intake.
- `GET /v1/events?limit=50` — recent privacy-minimized events.
- `GET /v1/events/{event_id}` — event + decision.
- `GET /v1/decisions/{decision_id}` — decision.
- `GET /v1/proofs/{event_id}` — hash-chained proof receipt.
- `GET /v1/metrics` — basic counters.

## Security and limits
- Raw plate text is not persisted or returned. A keyed HMAC token and masked value are stored.
- API uses one shared key for this pilot scaffold; deploy behind TLS and a private network. Add per-camera credentials/RBAC before multi-customer use.
- SQLite is suitable for a single-node pilot, not a multi-writer distributed deployment.
- Proof hashes are tamper-evident within the local chain; they are not an external trusted timestamp or proof of camera authenticity.
- No face recognition, watchlists, access decisions, payment decisions, barrier control, or automated denial.
- Configure lawful purpose, notice, retention, access controls, and customer authorization before processing real plates.

## Model requirement
A custom YOLO license-plate detection model is not included. Without weights, the API and manual event path work, but RTSP inference remains disabled/not ready. OCR is only attempted on detected plate crops.
