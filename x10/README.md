# X10 Remote Recovery MVP

X10 is a small control plane for remotely recovering an authorized Android/Termux camera agent.

## Safety model

- Every agent has a unique random bearer token.
- The hub stores only a SHA-256 hash of the agent token.
- Admin operations require `CORE_API_KEY`.
- The agent accepts only the allow-listed `restart_app` action.
- There is no arbitrary remote shell endpoint.
- Audit entries are hash-chained.
- Commands are queued, delivered once, acknowledged, and recorded.
- No hidden process names, credential hard-coding, or destructive purge endpoint.

## Flow

```
Android Agent -> heartbeat -> X10 Hub
Telegram/Admin -> restart -> command queue
Android Agent -> poll -> execute restart_app
Android Agent -> result -> X10 Hub
X10 Hub -> hash-chained audit
```

## API

### Register

```bash
curl -X POST "$HUB/api/x10/admin/agents" \
  -H "X-API-Key: $CORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"camera-01","targetPackage":"com.pas.webcam"}'
```

The response contains the agent token once. Store it in a secret manager or a 0600 local config file.

### Status

```bash
curl "$HUB/api/x10/admin/agents" -H "X-API-Key: $CORE_API_KEY"
```

### Restart

```bash
curl -X POST "$HUB/api/x10/admin/agents/camera-01/restart" \
  -H "X-API-Key: $CORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason":"camera health failure"}'
```

### Agent

The Android agent polls the hub over outbound HTTPS. No inbound Android port is required.

## Run tests

From `core/`:

```bash
npm test
```

The X10 tests run with Node's built-in test runner and do not require another service.
