"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validateAICPMessage,
  listReviewItems,
  decideReviewItem
} = require("../covenant-interop/aicp-gateway");

const keys = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
const replayDirs = [];

function canonicalize(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonicalize(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

function sign(message) {
  const unsigned = { ...message, payload: { ...message.payload } };
  delete unsigned.payload.signature;
  message.payload.signature = crypto.sign(
    null,
    Buffer.from(canonicalize(unsigned), "utf8"),
    keys.privateKey
  ).toString("base64");
  return message;
}

function validMessage(now = 1800000000) {
  return sign({
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
      privacy_preserved: false
    },
    proof_of_work: "opaque-demo-proof"
  });
}

function makeOptions(overrides = {}) {
  const replayStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-aicp-replay-"));
  replayDirs.push(replayStoreDir);
  return {
    now: 1800000000,
    allowedSenders: ["covenant-agent-1"],
    publicKeys: { "covenant-agent-1": publicKeyPem },
    replayStoreDir,
    ...overrides
  };
}

test.afterEach(() => {
  while (replayDirs.length) fs.rmSync(replayDirs.pop(), { recursive: true, force: true });
});

test("accepts a valid Ed25519-signed envelope for review only", () => {
  const result = validateAICPMessage(validMessage(), makeOptions());
  assert.equal(result.valid, true);
  assert.equal(result.protocolProfile, "SAMURAI_AICP_ED25519_V1");
  assert.equal(result.upstreamCompatible, false);
  assert.equal(result.trust, "SIGNATURE_VERIFIED_REVIEW_ONLY");
  assert.equal(result.acceptedFor, "HUMAN_REVIEW_ONLY");
  assert.equal(result.verified.cryptographicSignature, true);
  assert.equal(result.verified.signatureAlgorithm, "Ed25519");
  assert.equal(result.verified.proofOfWork, false);
  assert.equal(result.verified.privacyClaim, false);
  assert.equal(result.verified.replayProtection, true);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

test("fails closed when sender allowlist is empty or sender is unknown", () => {
  assert.ok(validateAICPMessage(validMessage(), makeOptions({ allowedSenders: [] })).errors.includes("SENDER_NOT_ALLOWLISTED"));
  assert.ok(validateAICPMessage(sign({ ...validMessage(), from_ai: "attacker" }), makeOptions()).errors.includes("SENDER_NOT_ALLOWLISTED"));
});

test("rejects messages addressed to another recipient", () => {
  const message = validMessage();
  message.to_ai = "another-agent";
  assert.ok(validateAICPMessage(message, makeOptions()).errors.includes("RECIPIENT_NOT_SAMURAI"));
});

test("rejects stale messages", () => {
  const message = validMessage(1800000000 - 301);
  assert.ok(validateAICPMessage(message, makeOptions()).errors.includes("TIMESTAMP_OUT_OF_WINDOW"));
});

test("rejects unapproved privileged intents", () => {
  const message = validMessage();
  message.intent = "execute_smart_contract";
  message.message_type = "smart_contract_execution";
  message.performative = "request";
  assert.ok(validateAICPMessage(sign(message), makeOptions()).errors.includes("INTENT_NOT_ALLOWED"));
});

test("rejects mismatched intent metadata and missing payload fields", () => {
  const message = sign({
    ...validMessage(),
    performative: "request",
    payload: { signature: "", model_version: "demo-v1" }
  });
  const result = validateAICPMessage(message, makeOptions());
  assert.ok(result.errors.includes("PERFORMATIVE_MISMATCH"));
  assert.ok(result.errors.includes("PAYLOAD_FIELD_REQUIRED:gradient_hash"));
});

test("rejects a claimed privacy flag that is not boolean", () => {
  const message = validMessage();
  message.payload.privacy_preserved = "true";
  assert.ok(validateAICPMessage(sign(message), makeOptions()).errors.includes("PRIVACY_FLAG_MUST_BE_BOOLEAN"));
});

test("rejects oversized messages", () => {
  const message = validMessage();
  message.payload.padding = "x".repeat(33 * 1024);
  assert.ok(validateAICPMessage(sign(message), makeOptions()).errors.includes("MESSAGE_TOO_LARGE"));
});

test("rejects a missing sender public key", () => {
  const result = validateAICPMessage(validMessage(), makeOptions({ publicKeys: {} }));
  assert.ok(result.errors.includes("SIGNATURE_KEY_NOT_CONFIGURED"));
});

test("rejects a modified payload after signing", () => {
  const message = validMessage();
  message.payload.contribution_score = 999;
  const result = validateAICPMessage(message, makeOptions());
  assert.ok(result.errors.includes("SIGNATURE_INVALID"));
});

test("rejects malformed signature encoding", () => {
  const message = validMessage();
  message.payload.signature = "not-a-signature";
  const result = validateAICPMessage(message, makeOptions());
  assert.ok(result.errors.includes("SIGNATURE_INVALID"));
});

test("rejects a duplicate message id in the same process", () => {
  const message = validMessage();
  const options = makeOptions();
  assert.equal(validateAICPMessage(message, options).valid, true);
  const duplicate = validateAICPMessage(message, options);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.includes("REPLAY_DETECTED"));
});

test("replay reservation survives a new gateway instance using the same durable directory", () => {
  const message = validMessage();
  const firstOptions = makeOptions();
  assert.equal(validateAICPMessage(message, firstOptions).valid, true);
  const restartedOptions = {
    ...firstOptions,
    now: firstOptions.now,
    publicKeys: { "covenant-agent-1": publicKeyPem }
  };
  const afterRestart = validateAICPMessage(message, restartedOptions);
  assert.equal(afterRestart.valid, false);
  assert.ok(afterRestart.errors.includes("REPLAY_DETECTED"));
});

test("fails closed when durable replay storage is unavailable", () => {
  const result = validateAICPMessage(validMessage(), makeOptions({ replayStoreDir: null }));
  assert.ok(result.errors.includes("REPLAY_STORE_NOT_CONFIGURED"));
});


test("accepted message enters a durable metadata-only human review queue", () => {
  const options = makeOptions();
  const message = validMessage();
  assert.equal(validateAICPMessage(message, options).valid, true);
  const items = listReviewItems(options.replayStoreDir);
  assert.equal(items.length, 1);
  assert.equal(items[0].sender, "covenant-agent-1");
  assert.equal(items[0].messageId, "msg-001");
  assert.equal(items[0].reviewStatus, "PENDING_HUMAN_REVIEW");
  assert.equal(items[0].killCritic.decision, "PASS_TO_HUMAN_REVIEW");
  assert.equal(items[0].killCritic.executionAuthorized, false);
  assert.equal(Object.prototype.hasOwnProperty.call(items[0], "payload"), false);
});

test("human approval permits manual handoff only and cannot be repeated", () => {
  const options = makeOptions();
  assert.equal(validateAICPMessage(validMessage(), options).valid, true);
  const decision = decideReviewItem(
    options.replayStoreDir, "covenant-agent-1", "msg-001", "approve", "Reviewed by operator"
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.reviewStatus, "APPROVED_FOR_MANUAL_HANDOFF");
  const items = listReviewItems(options.replayStoreDir);
  assert.equal(items[0].reviewStatus, "APPROVED_FOR_MANUAL_HANDOFF");
  const duplicate = decideReviewItem(
    options.replayStoreDir, "covenant-agent-1", "msg-001", "reject", "second decision"
  );
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "REVIEW_ALREADY_DECIDED");
});

test("human rejection is durable and unknown review items cannot be decided", () => {
  const options = makeOptions();
  assert.equal(validateAICPMessage(validMessage(), options).valid, true);
  const decision = decideReviewItem(
    options.replayStoreDir, "covenant-agent-1", "msg-001", "reject", "Untrusted request"
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.reviewStatus, "REJECTED");
  const missing = decideReviewItem(
    options.replayStoreDir, "covenant-agent-1", "missing", "approve"
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "REVIEW_ITEM_NOT_FOUND");
});
