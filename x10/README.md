# X10 Auto-Heal MVP

Remote reliability control for authorized Android/edge devices.

## Security model
- Per-agent random credential, stored only as a SHA-256 hash by the Hub.
- Admin token required for registration, status, restart and audit.
- Telegram access can be restricted by chat ID.
- Commands are queued and acknowledged; execution is auditable.
- No destructive wipe, stealth, credential hardcoding or remote shell execution.

## Quick start
1. Copy `.env.example` to `.env` and generate a strong X10_ADMIN_TOKEN.
2. Set BOT_TOKEN and optionally X10_ALLOWED_CHAT_IDS.
3. Run `docker compose up -d --build`.
4. Register an agent:
```
curl -X POST http://HUB:8080/v1/agents/register \
  -H "X-X10-Admin: $X10_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"android-01","name":"Camera Android","version":"0.1"}'
```
5. Put returned token into the Android agent environment:
```
export X10_HUB=http://HUB:8080
export X10_AGENT_ID=android-01
export X10_AGENT_TOKEN='returned-token'
python ~/x10-agent/agent.py
```

The next production layer should add HTTPS/TLS termination, device enrollment/rotation, health probes for the actual video stream, retries with backoff, metrics and signed releases.
