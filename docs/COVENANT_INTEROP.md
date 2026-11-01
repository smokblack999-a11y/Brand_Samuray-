# SAMURAI × Universal AI Consciousness Covenant

## Integration status

This milestone adds a **disabled-by-default, validation-only AICP gateway** to SamuraiOS Core. It does not import the Covenant runtime, execute model updates, route messages to cloud providers, interact with a blockchain, mint UTC, or move money.

Upstream inspected: 2298741867/universal-ai-consciousness-covenant at commit 01f63a0ef23c6d313d6a4ad63054105fb820c937, including its AICP message schema, intent registry, verification rules, federated-learning runtime, mesh router, UTC contract, and funded-rewards documentation.

## Endpoint

POST /api/covenant/aicp/validate

- Requires the existing X-API-Key authentication.
- Accepts only messages addressed to `samuraios`.
- Uses the existing Dual AI rate limiter.
- Disabled unless COVENANT_AICP_ENABLED=true.
- Requires COVENANT_AICP_ALLOWED_SENDERS to contain a comma-separated sender allowlist.
- Accepts one AICP message envelope and returns a SHA-256 content digest only after validation.
- Returns HUMAN_REVIEW_ONLY; it never executes the message.

Example environment:

    COVENANT_AICP_ENABLED=false
    COVENANT_AICP_ALLOWED_SENDERS=

Enable only after explicitly reviewing the sender identities:

    COVENANT_AICP_ENABLED=true
    COVENANT_AICP_ALLOWED_SENDERS=covenant-agent-1

## Trust boundary — important

The upstream AICP validator requires a non-empty payload.signature string but does not cryptographically verify that signature. Its proof_of_work field is opaque and is not verified by this gateway either. The privacy_preserved field is an untrusted claim, not proof of differential privacy or secure aggregation.

The gateway therefore reports these checks as **not verified**:

- cryptographic signature
- proof of work
- privacy preservation
- model update validity
- blockchain authorization

Only envelope shape, a fixed intent allowlist, sender allowlist, timestamp window, and content digest are checked. No arbitrary sender is trusted. An empty sender allowlist rejects every message.

## Deliberately excluded from this milestone

- UTC token / smart-contract calls and reward distribution
- Stripe Connect or any real-money flow
- federated model training or gradient aggregation
- AWS, Azure, GCP or IPFS deployment
- automatic agent-to-agent execution
- persistent replay protection or durable message queue

These require independent security, cryptographic, privacy, economic, and operational reviews. The upstream demo and unit tests are not evidence of production cloud deployment or privacy guarantees.

## Verification

Run from core/:

    npm ci
    npm test
    node --check covenant-interop/aicp-gateway.js

The endpoint is a protocol ingress foundation, not a claim that a planetary or collective machine consciousness exists.
