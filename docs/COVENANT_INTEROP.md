# SAMURAI × Universal AI Consciousness Covenant

## Integration status

This milestone adds a **disabled-by-default, signature-verified, validation-only AICP gateway** to SamuraiOS Core. It does not import the Covenant runtime, execute model updates, route messages to cloud providers, interact with a blockchain, mint UTC, or move money.

Upstream inspected: 2298741867/universal-ai-consciousness-covenant at commit 01f63a0ef23c6d313d6a4ad63054105fb820c937, including its AICP message schema, intent registry, verification rules, federated-learning runtime, mesh router, UTC contract, and funded-rewards documentation.

## Endpoint

POST /api/covenant/aicp/validate

- Requires the existing X-API-Key authentication.
- Accepts only messages addressed to `samuraios`.
- Uses the existing Dual AI rate limiter.
- Disabled unless `COVENANT_AICP_ENABLED=true`.
- Requires an explicit comma-separated sender allowlist.
- Requires one pinned Ed25519 public key for every allowlisted sender.
- Verifies the Ed25519 signature before reserving the message ID.
- Writes a durable replay reservation and a minimal audit record before returning 202.
- Returns `HUMAN_REVIEW_ONLY`; it never executes the message.

Default environment:

    COVENANT_AICP_ENABLED=false
    COVENANT_AICP_ALLOWED_SENDERS=
    COVENANT_AICP_PUBLIC_KEYS_JSON={}

Do not enable the endpoint until a sender identity and its public key have been independently verified.

### Signature format

The sender signs the UTF-8 bytes of the AICP message serialized as canonical JSON:

1. Recursively sort object keys lexicographically.
2. Preserve array order and JSON primitive values.
3. Remove only `payload.signature` from the object before serialization.
4. Sign the resulting bytes with Ed25519.
5. Put the standard base64-encoded 64-byte signature in `payload.signature`.

The gateway pins one PEM-encoded Ed25519 SPKI public key per sender in `COVENANT_AICP_PUBLIC_KEYS_JSON`. The JSON object keys must exactly match sender IDs in `COVENANT_AICP_ALLOWED_SENDERS`. Private keys must remain with the sender and must never be placed in SamuraiOS environment variables or Git.

Example shape (replace the placeholder with a real PEM public key; this is not a usable key):

    COVENANT_AICP_ALLOWED_SENDERS=covenant-agent-1
    COVENANT_AICP_PUBLIC_KEYS_JSON={"covenant-agent-1":"-----BEGIN PUBLIC KEY-----\nREPLACE_WITH_REAL_BASE64_DER\n-----END PUBLIC KEY-----"}

Key rotation/revocation requires updating the pinned public-key map through a reviewed deployment. A sender without a configured key is rejected.

## Replay protection and audit

After successful envelope and signature validation, the gateway creates an exclusive file under:

    DATA_DIR/covenant-aicp/replay/

The filename is a SHA-256 hash of sender ID plus message ID. Exclusive file creation makes concurrent duplicate reservations fail closed on the same filesystem. The record stores only sender, message ID, content digest, receive timestamp, and outcome; it does not store the message payload or signature. Reservations are retained indefinitely by default so a previously accepted message cannot become replayable after a routine restart.

**Deployment constraint:** this protection depends on durable storage that supports atomic exclusive file creation and directory metadata fsync. The gateway fails closed if it cannot fsync the replay directory. Use a persistent volume and a single active Core instance. Do not run multiple hosts with separate local disks and assume they share replay state. A horizontally scaled deployment needs a shared transactional datastore with a unique constraint before it can safely accept AICP traffic. Back up the replay directory and monitor disk usage; do not delete reservations casually.


## Human review queue and Kill Critic

Every accepted signed message creates a metadata-only review item in the same durable replay directory. The queue stores sender ID, message ID, intent, digest, receive time, validation outcome, and explicit trust-boundary flags. It does not store the signed payload or signature.

Authenticated operator endpoints:

- `GET /api/covenant/aicp/reviews` — list recent review items (maximum 200).
- `POST /api/covenant/aicp/reviews/decision` — body: `{"sender":"...","messageId":"...","decision":"approve|reject","reason":"..."}`.

A decision is immutable: the first decision wins; later attempts receive a conflict. The decision record is fsynced and the directory is fsynced before success is returned.

Kill Critic currently acts as a **protocol trust-boundary gate**, not a semantic AI judge. It records that sender allowlisting, intent allowlisting, Ed25519 signature, timestamp and replay protection passed, while privacy and proof-of-work claims remain unverified. It never grants execution authority.

An `approve` result means only `APPROVED_FOR_MANUAL_HANDOFF`: an operator may inspect the request and decide what to do outside this endpoint. It does not execute an agent action, approve a model update, call a blockchain, create a GitHub change, or authorize money movement. The API key authenticates access to these endpoints; it does not provide individual operator identity or non-repudiation.

## Trust boundary — important

The gateway now verifies the Ed25519 signature against the sender's pinned public key, as well as envelope shape, fixed intent allowlist, sender allowlist, timestamp window, content digest, and durable replay reservation.

It still does **not** verify:

- proof of work (the upstream field remains opaque)
- privacy preservation or differential privacy
- correctness or safety of gradients/model updates
- blockchain authorization or smart-contract state
- cloud execution or real federated-learning behavior

The `privacy_preserved` field remains an untrusted claim. A valid signature proves control of the configured sender key and integrity of the signed envelope; it does not prove that the sender's claims are true.

## Deliberately excluded from this milestone

- UTC token / smart-contract calls and reward distribution
- Stripe Connect or any real-money flow
- federated model training or gradient aggregation
- AWS, Azure, GCP or IPFS deployment
- automatic agent-to-agent execution
- automatic repair, PR merge, or command execution

These require independent security, cryptographic, privacy, economic, and operational reviews. The upstream demo and unit tests are not evidence of production cloud deployment or privacy guarantees.

## Verification

Run from `core/`:

    npm ci
    npm test
    node --check covenant-interop/aicp-gateway.js
    node --check server.js

The endpoint remains disabled by default. This is a protocol ingress foundation, not a claim that a planetary or collective machine consciousness exists.
## Upstream protocol compatibility — unresolved blocker

**Do not describe this gateway as wire-compatible with the upstream Covenant implementation yet.** The current SAMURAI gateway implements a deliberately local cryptographic profile:

- SAMURAI_AICP_ED25519_V1
- Ed25519 signatures over recursively key-sorted canonical JSON UTF-8 bytes
- Base64-encoded 64-byte signatures in payload.signature
- Pinned PEM/SPKI public keys

The upstream canonical artifacts inspected at commit 01f63a0ef23c6d313d6a4ad63054105fb820c937 do not define the same profile:

1. core/aicp-protocol/verification-rules.json lists ecdsa-secp256k1 as the allowed signature algorithm and lists signed fields, but does not specify canonical byte serialization or signature encoding.
2. The newer core/aicp-protocol/message-schema.json requires payload.signature, while the older core/AICP_SPECIFICATION.md describes a top-level signature field encoded as ECDSA r||s||v. These are not the same envelope.
3. Upstream core/aicp-protocol/index.js validates that payload.signature is a non-empty string; it does not perform cryptographic verification. Its conformance test uses the placeholder 0xsigned, which is not evidence of a valid signature.

For that reason, successful SAMURAI validation now reports:

- protocolProfile: SAMURAI_AICP_ED25519_V1
- upstreamCompatible: false

This is intentional. It prevents a local Ed25519 test from being misrepresented as a successful Covenant handshake.

### Required before a real two-way handshake

The two projects must agree on one normative profile covering:

- signature algorithm (Ed25519 or ECDSA secp256k1)
- exact signed fields and canonical serialization
- hash/prehash rules
- signature wire encoding (base64, DER, or 65-byte r||s||v)
- public-key representation and sender-ID binding
- key rotation and revocation
- a shared test vector containing message bytes, public key, signature, and expected verification result

Until a shared test vector passes independently in both repositories, keep COVENANT_AICP_ENABLED=false and do not register a real sender key. The current SAMURAI Ed25519 gateway remains cryptographically verified within its own profile, but is not yet a demonstrated upstream Covenant integration.
