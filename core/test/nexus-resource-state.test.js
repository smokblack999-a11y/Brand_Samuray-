"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyChange,
  evaluatePolicy,
  transition,
  createProofReceipt
} = require("../nexus-resource-state");

test("critical paths are classified from changed files, not substring-only answer text", () => {
  const result = classifyChange([
    "src/auth/login.js",
    ".github/workflows/build.yml",
    "README.md"
  ]);

  assert.equal(result.critical, true);
  assert.deepEqual(result.controls, ["ci_review", "proof_receipt", "sandbox", "security_review", "human_review"].sort());
  assert.equal(result.matches.some(x => x.rule === "auth"), true);
  assert.equal(result.matches.some(x => x.rule === "workflow"), true);
});

test("policy fails closed for unknown actor", () => {
  const result = evaluatePolicy({
    paths: ["src/service.js"],
    actor: "unknown"
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.fail_closed, true);
});

test("critical repair requires explicit controls", () => {
  const blocked = evaluatePolicy({
    paths: ["src/crypto/key.js"],
    actor: "agent",
    evidence: {}
  });

  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.reasons.includes("missing_sandbox"));
  assert.ok(blocked.reasons.includes("missing_security_review"));
});

test("critical repair can be allowed only with explicit evidence", () => {
  const allowed = evaluatePolicy({
    paths: ["src/crypto/key.js"],
    actor: "agent",
    evidence: {
      sandbox: true,
      security_review: true
    }
  });

  assert.equal(allowed.decision, "ALLOW");
  assert.equal(allowed.critical, true);
});

test("invalid state transitions are rejected", () => {
  assert.throws(
    () => transition("CI_FAILED", "DEPLOYED"),
    /invalid_transition/
  );
});

test("proof receipt binds transition and head sha", () => {
  const receipt = createProofReceipt({
    resource_id: "github://repo/pull/57",
    from_state: "CI_FAILED",
    to_state: "AI_PATCH_PROPOSED",
    action: "repair",
    head_sha: "abc123",
    validation: { critic: "pass" }
  });

  assert.equal(receipt.version, 2);
  assert.equal(receipt.transition.from, "CI_FAILED");
  assert.equal(receipt.transition.to, "AI_PATCH_PROPOSED");
  assert.equal(receipt.head_sha, "abc123");
  assert.match(receipt.proof_hash, /^[a-f0-9]{64}$/);
});
