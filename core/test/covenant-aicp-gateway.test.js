"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAICPMessage } = require("../covenant-interop/aicp-gateway");

function validMessage(now = 1800000000) {
  return {
    version: "1.0",
    message_id: "msg-001",
    from_ai: "covenant-agent-1",
    to_ai: "samuraios",
    message_type: "contribution_update",
    performative: "inform",
    timestamp: now,
    intent: "submit_gradient_update",
    payload: {
      model_version: "demo-v1",
      gradient_hash: "sha256:example",
      contribution_score: 12,
      privacy_preserved: false,
      signature: "unverified-demo-signature"
    },
    proof_of_work: "opaque-demo-proof"
  };
}

const options = { now: 1800000000, allowedSenders: ["covenant-agent-1"] };

test("accepts an allowlisted AICP envelope for review only", () => {
  const result = validateAICPMessage(validMessage(), options);
  assert.equal(result.valid, true);
  assert.equal(result.trust, "UNVERIFIED_EXTERNAL_INPUT");
  assert.equal(result.acceptedFor, "HUMAN_REVIEW_ONLY");
  assert.equal(result.verified.cryptographicSignature, false);
  assert.equal(result.verified.proofOfWork, false);
  assert.equal(result.verified.privacyClaim, false);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

test("fails closed when sender allowlist is empty or sender is unknown", () => {
  assert.ok(validateAICPMessage(validMessage(), { now: options.now }).errors.includes("SENDER_NOT_ALLOWLISTED"));
  assert.ok(validateAICPMessage({ ...validMessage(), from_ai: "attacker" }, options).errors.includes("SENDER_NOT_ALLOWLISTED"));
});

test("rejects stale messages", () => {
  const message = validMessage(options.now - 301);
  assert.ok(validateAICPMessage(message, options).errors.includes("TIMESTAMP_OUT_OF_WINDOW"));
});

test("rejects unapproved privileged intents", () => {
  const message = { ...validMessage(), intent: "execute_smart_contract", message_type: "smart_contract_execution", performative: "request" };
  assert.ok(validateAICPMessage(message, options).errors.includes("INTENT_NOT_ALLOWED"));
});

test("rejects mismatched intent metadata and missing payload fields", () => {
  const message = { ...validMessage(), performative: "request", payload: { signature: "x" } };
  const result = validateAICPMessage(message, options);
  assert.ok(result.errors.includes("PERFORMATIVE_MISMATCH"));
  assert.ok(result.errors.includes("PAYLOAD_FIELD_REQUIRED:model_version"));
});

test("rejects a claimed privacy flag that is not boolean", () => {
  const message = validMessage();
  message.payload.privacy_preserved = "true";
  assert.ok(validateAICPMessage(message, options).errors.includes("PRIVACY_FLAG_MUST_BE_BOOLEAN"));
});

test("rejects oversized messages", () => {
  const message = validMessage();
  message.payload.padding = "x".repeat(33 * 1024);
  assert.ok(validateAICPMessage(message, options).errors.includes("MESSAGE_TOO_LARGE"));
});
