#!/data/data/com.termux/files/usr/bin/bash
set -eu

# X10 Android Agent: explicit, visible, allow-listed recovery only.
# Required env:
#   X10_HUB_URL      e.g. https://hub.example.com
#   X10_AGENT_ID     e.g. camera-01
#   X10_AGENT_TOKEN  per-agent bearer token
# Optional:
#   X10_TARGET_PACKAGE=com.pas.webcam
#   X10_INTERVAL=30

X10_HUB_URL="${X10_HUB_URL:?X10_HUB_URL is required}"
X10_AGENT_ID="${X10_AGENT_ID:?X10_AGENT_ID is required}"
X10_AGENT_TOKEN="${X10_AGENT_TOKEN:?X10_AGENT_TOKEN is required}"
X10_TARGET_PACKAGE="${X10_TARGET_PACKAGE:-com.pas.webcam}"
X10_INTERVAL="${X10_INTERVAL:-30}"
X10_VERSION="${X10_VERSION:-0.1.0}"

api() {
  curl -fsS --max-time 10 \
    -H "Authorization: Bearer ${X10_AGENT_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

heartbeat() {
  local status="$1"
  api -X POST "${X10_HUB_URL}/api/x10/agent/${X10_AGENT_ID}/heartbeat" \
    -d "{"status":"${status}","version":"${X10_VERSION}"}" >/dev/null || true
}

restart_app() {
  am force-stop "${X10_TARGET_PACKAGE}" || return 1
  sleep 1
  am start -n "${X10_TARGET_PACKAGE}/.MainActivity" -f 0x10000000 >/dev/null 2>&1
}

heartbeat "STARTING"

while true; do
  if cmd package resolve-activity --brief "${X10_TARGET_PACKAGE}" >/dev/null 2>&1; then
    heartbeat "OK"
  else
    heartbeat "TARGET_UNAVAILABLE"
  fi

  command_json="$(api "${X10_HUB_URL}/api/x10/agent/${X10_AGENT_ID}/commands" || true)"

  if command -v python3 >/dev/null 2>&1; then
    command_id="$(printf '%s' "${command_json}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("command") or {}).get("id",""))' 2>/dev/null || true)"
    command_action="$(printf '%s' "${command_json}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("command") or {}).get("action",""))' 2>/dev/null || true)"
  else
    command_id=""
    command_action=""
  fi

  if [ "${command_action}" = "restart_app" ] && [ -n "${command_id}" ]; then
    if restart_app; then
      result_status="completed"
      result_message="target restart requested"
      heartbeat "RECOVERED"
    else
      result_status="failed"
      result_message="target restart failed"
      heartbeat "RECOVERY_FAILED"
    fi

    api -X POST "${X10_HUB_URL}/api/x10/agent/${X10_AGENT_ID}/commands/${command_id}/result" \
      -d "{"status":"${result_status}","message":"${result_message}"}" >/dev/null || true
  fi

  sleep "${X10_INTERVAL}"
done
