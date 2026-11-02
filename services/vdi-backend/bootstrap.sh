#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SERVICE_DIR"

for command in docker openssl curl id; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $command" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  umask 077
  api_key="$(openssl rand -hex 32)"
  token_secret="$(openssl rand -hex 32)"
  cat > .env <<EOF
VDI_API_KEY=$api_key
PLATE_TOKEN_SECRET=$token_secret
DATABASE_PATH=./data/vdi.sqlite3
ENABLE_RTSP=false
RTSP_URL=
CAMERA_ID=rtsp-camera-01
YOLO_MODEL_PATH=/models/license-plate.pt
YOLO_CLASS_ID=
OCR_LANGUAGES=en
MIN_OCR_CONFIDENCE=0.70
FRAME_INTERVAL_SECONDS=1.0
MAX_FRAME_WIDTH=1280
VDI_BIND_HOST=127.0.0.1
VDI_UID=$(id -u)
VDI_GID=$(id -g)
EOF
  chmod 600 .env
  echo "Created .env with fresh secrets (file permissions 600)."
else
  echo "Existing .env preserved; no secrets were overwritten."
  if grep -q '^VDI_UID=' .env; then
    sed -i "s/^VDI_UID=.*/VDI_UID=$(id -u)/" .env
  else
    echo "VDI_UID=$(id -u)" >> .env
  fi
  if grep -q '^VDI_GID=' .env; then
    sed -i "s/^VDI_GID=.*/VDI_GID=$(id -g)/" .env
  else
    echo "VDI_GID=$(id -g)" >> .env
  fi
  chmod 600 .env
fi

mkdir -p data weights
chmod 700 data

api_key="$(sed -n 's/^VDI_API_KEY=//p' .env | head -n 1)"
token_secret="$(sed -n 's/^PLATE_TOKEN_SECRET=//p' .env | head -n 1)"
if [[ "${#api_key}" -lt 32 || "${#token_secret}" -lt 32 ]] \
  || [[ "$api_key" == replace-* || "$token_secret" == replace-* ]]; then
  echo "ERROR: VDI_API_KEY and PLATE_TOKEN_SECRET must each be at least 32 characters and must not be placeholders." >&2
  exit 1
fi

enable_rtsp="$(sed -n 's/^ENABLE_RTSP=//p' .env | head -n 1 | tr '[:upper:]' '[:lower:]')"
if [[ "$enable_rtsp" == "true" || "$enable_rtsp" == "1" ]]; then
  echo "ERROR: bootstrap is local shadow-only and refuses ENABLE_RTSP=true. Configure camera processing separately after explicit authorization." >&2
  exit 1
fi

bind_host="$(sed -n 's/^VDI_BIND_HOST=//p' .env | head -n 1)"
if [[ -n "$bind_host" && "$bind_host" != "127.0.0.1" && "$bind_host" != "localhost" ]]; then
  echo "ERROR: local bootstrap only permits VDI_BIND_HOST=127.0.0.1 or localhost." >&2
  exit 1
fi

echo "Building and starting VDI in read-only/shadow mode (RTSP remains disabled)..."
docker compose up -d --build

ready=0
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8090/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:8090/ready >/dev/null 2>&1 \
    && curl -fsS -H "X-API-Key: $api_key" http://127.0.0.1:8090/v1/metrics >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "ERROR: VDI did not become ready. Recent container logs:" >&2
  docker compose logs --tail=100 >&2 || true
  exit 1
fi

echo
echo "VDI is running and authenticated API self-check passed."
echo "API docs: http://127.0.0.1:8090/docs"
echo "Health:   http://127.0.0.1:8090/health"
echo "Ready:    http://127.0.0.1:8090/ready"
echo
echo "Safety defaults: RTSP disabled; no camera, barrier or payment action is connected."
echo "Configure an operator-approved tariff through POST /v1/tariffs before tariff reconciliation."
echo "Keep .env private. Do not expose port 8090 to the internet without TLS and production authentication."
