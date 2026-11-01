# SAMURAI × Universal AI Consciousness Covenant: Interoperability v1

## Scope

This module is a **passive, opt-in message bridge** for a narrow AICP-shaped envelope based on the public Covenant repository's demonstrated message fields. It is not a claim of full AICP standards conformance, AI consciousness, federated training, blockchain deployment, or cloud federation.

The bridge records authenticated messages for later inspection. It does not execute commands, invoke tools, modify leads, run model updates, mint UTC, transfer money, or trigger autonomous repairs. NEXUS and Kill Critic remain the authority for any future action.

## Implemented in this SAMURAI branch

- Versioned envelope validation (version 1.0).
- Strict allowlist of intents and performatives.
- HMAC-SHA256 authentication with a shared secret of at least 32 UTF-8 bytes.
- Canonical JSON serialization before signing and verification.
- Constant-time signature comparison.
- Five-minute timestamp window to reduce replay risk.
- Persistent JSONL event journal with fsync, restrictive file permissions, duplicate detection, and message-ID conflict rejection.
- Event listing returns metadata and hashes only; the payload is never returned from the listing endpoint.
- Disabled by default; no new dependency.

## Configuration

Add these variables to the SAMURAI Core environment:

~~~env
COVENANT_INTEROP_ENABLED=false
COVENANT_INTEROP_SECRET=
~~~

To enable the bridge, set COVENANT_INTEROP_ENABLED=true and provision the same high-entropy secret to both communicating systems through their secret stores. Never commit the secret. Rotate it immediately if exposure is suspected.

When enabled, the following routes are available:

| Route | Authentication | Behavior |
|---|---|---|
| GET /api/covenant/health | SAMURAI X-API-Key | Reports feature/configuration state |
| POST /api/covenant/aicp | HMAC-SHA256 envelope signature | Validates and records an event; no execution |
| GET /api/covenant/events?limit=50 | SAMURAI X-API-Key | Returns up to 100 metadata-only event summaries |

The journal is stored at DATA_DIR/covenant-interop-events.jsonl (or core/data/covenant-interop-events.jsonl when DATA_DIR is unset). This local JSONL journal is intended for a **single Core instance**. Multi-instance production deployments should replace it with a transactional shared database before scaling horizontally.

## Envelope

All fields below are covered by the HMAC except signature, which is the HMAC-SHA256 hex digest of canonical JSON for the remaining fields.

~~~json
{
  "version": "1.0",
  "message_id": "covenant-event-001",
  "intent": "agent.audit.receipt",
  "from_ai": "covenant-agent",
  "to_ai": "samurai-core",
  "message_type": "audit_receipt",
  "performative": "inform",
  "timestamp": 1798000000,
  "payload": {
    "result": "pass",
    "source_sha": "0123456789abcdef"
  },
  "signature": "64-character-lowercase-hex-hmac-sha256"
}
~~~

Allowed intents: submit_gradient_update, observe_round, lead.intent.detected, agent.task.proposed, agent.audit.receipt, contribution.evidence.recorded.

Allowed performatives: inform, propose, confirm, refuse.

Example local signer:

~~~js
const { createEnvelope } = require("./covenant-interop");
const envelope = createEnvelope({
  intent: "agent.audit.receipt",
  from_ai: "covenant-agent",
  to_ai: "samurai-core",
  message_type: "audit_receipt",
  performative: "inform",
  payload: { result: "pass", source_sha: "0123456789abcdef" }
}, { secret: process.env.COVENANT_INTEROP_SECRET });
~~~

## Compatibility boundary with the reference repository

The public Covenant demo currently shows fields such as version, message_id, intent, from_ai, to_ai, message_type, performative, timestamp, and payload. The sample's payload.signature and proof_of_work strings are not accepted as authentication evidence by this bridge. A real shared-key HMAC must be generated and verified on both sides.

The bridge intentionally rejects unknown top-level fields. The reference sender must therefore add a top-level signature field generated over the canonical unsigned envelope before it can interoperate with this implementation.

This integration does not contact the reference repository, AWS, Azure, GCP, IPFS, Filecoin, Ethereum, Polygon, or Stripe. No live key, wallet, payment, token, or cloud credential is required.

## Verification

Run:

~~~bash
cd core
npm test
node --check covenant-interop/index.js
~~~

The tests cover signature tampering, rejected intents, timestamp replay window, weak secrets, unsupported unsigned metadata, persistence, idempotency, message-ID conflicts, corrupt journal fail-closed behavior, and payload redaction in event listings.

## Release gate still required

1. Add an independently implemented signer to the remote Covenant participant and verify cross-language test vectors.
2. Provision and rotate the shared secret through managed secret storage.
3. Replace the local JSONL journal with a transactional shared store before horizontal scaling.
4. Run the full SAMURAI Core CI suite and a staging end-to-end test.
5. Keep every actionable message behind Kill Critic, explicit authorization, sandbox, CI, and review. Do not auto-execute AICP requests.
