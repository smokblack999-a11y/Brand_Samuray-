# AICP Interoperability Proposal (Non-Normative)

Status: proposal only; not accepted by the upstream Covenant maintainers.

## Why an adapter cannot safely be enabled yet

The upstream repository currently exposes incompatible AICP message definitions:

- `core/aicp-protocol/message-schema.json` describes a `version` / `from_ai` / `to_ai` envelope and places a required signature at `payload.signature`.
- `core/AICP_SPECIFICATION.md` describes a different envelope using `protocol`, `sender`, `semantic_alignment`, and a top-level signature encoded as 65-byte ECDSA `r || s || v`.
- `core/aicp-protocol/verification-rules.json` names `ecdsa-secp256k1`, but does not fully define canonical signed bytes, prehash, signature encoding, or sender identity binding.
- `core/aicp-protocol/index.js` checks that `payload.signature` is a non-empty string; it does not cryptographically verify the signature.

These definitions cannot be treated as one wire protocol without an explicit version/profile decision.

## Proposed resolution for upstream maintainer review

Choose exactly one normative message schema for AICP v1.0. Mark the other format as legacy or non-normative, or assign it a distinct protocol version.

Candidate Ethereum-compatible signature profile (not implemented and not yet accepted):

1. Algorithm: ECDSA secp256k1.
2. Canonical serialization: RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8.
3. Signed object: the complete normative message with exactly one defined signature property removed. The spec must say whether this is top-level `signature` or `payload.signature`.
4. Signature scheme: EIP-191 `personal_sign` over the canonical bytes.
5. Wire encoding: 65-byte recoverable `r || s || v` hex; specify `v` convention (27/28 or 0/1), low-s requirements, and normalization.
6. Identity binding: recover the signer address and require it to equal the sender's registered node ID. Do not trust a claimed public key or address without verification.
7. Define key registration, rotation, revocation, timestamp window, and replay protection.

This is a candidate only. Do not infer that upstream currently uses JCS or EIP-191.

## Shared conformance vector required

Before enabling an upstream sender, both projects must pass the same deterministic fixture containing:

- exact message JSON before signing;
- canonical UTF-8 bytes or their hex representation;
- algorithm, prefix, and prehash rules;
- test-only private key and expected sender address;
- exact signature bytes and wire encoding;
- recovered signer address;
- positive verification and negative tests for tampering, wrong sender, malformed signature, and replay.

## Current SAMURAI state

SAMURAI currently implements only its local `SAMURAI_AICP_ED25519_V1` profile. Successful local verification reports `upstreamCompatible: false`. The endpoint remains disabled by default. No external sender key is registered, and no message is executed or used for model training.

## External coordination status

An attempt to open an upstream GitHub issue requesting a normative profile and shared test vector was rejected by GitHub with HTTP 403 (`Resource not accessible by integration`). No issue was created. The proposal is preserved here so it can be sent through an authorized upstream maintainer account or discussed in the upstream project's existing communication channel.