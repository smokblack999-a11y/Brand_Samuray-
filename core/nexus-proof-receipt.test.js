"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createVerifiedProofReceipt, verifyVerifiedProofReceipt } = require("./nexus-proof-receipt");

function input(overrides = {}) {
  return {
    jobId: "job-1",
    repository: "acme/app",
    runId: 42,
    baseSha: "base",
    patchSha: "patch",
    headSha: "head",
    diagnosis: {
      category: "test_failure",
      confidence: 0.99,
      fingerprint: "failure-fp-1"
    },
    proposal: {
      status: "PATCH_CANDIDATE",
      scope: { paths: ["src/a.js"], maxFiles: 3 }
    },
    critic: {
      decision: "PASS",
      evidenceHash: "a".repeat(64)
    },
    sandbox: {
      passed: true,
      commands: [{ command: "npm test", code: 0, signal: null, timedOut: false, passed: true, stdout: "ok", stderr: "" }]
    },
    tests: { passed: true, total: 12, failed: 0, command: "npm test" },
    security: "PASS",
    policy: "PASS",
    ...overrides
  };
}

test("creates a SHIP receipt only from complete evidence", () => {
  const receipt = createVerifiedProofReceipt(input());
  assert.equal(receipt.decision, "SHIP");
  assert.equal(receipt.critic.evidenceHash, "a".repeat(64));
  assert.match(receipt.receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyVerifiedProofReceipt(receipt), true);
});

test("same evidence produces the same proof id and receipt hash", () => {
  const a = createVerifiedProofReceipt(input());
  const b = createVerifiedProofReceipt(input());
  assert.equal(a.proofId, b.proofId);
  assert.equal(a.receiptHash, b.receiptHash);
});

test("Kill Critic failure cannot produce a receipt", () => {
  assert.throws(
    () => createVerifiedProofReceipt(input({ critic: { decision: "KILL", evidenceHash: "a".repeat(64) } })),
    /Kill Critic PASS/
  );
});

test("sandbox failure cannot produce a receipt", () => {
  assert.throws(
    () => createVerifiedProofReceipt(input({ sandbox: { passed: false, commands: [] } })),
    /sandbox\.passed=true/
  );
});

test("failed tests cannot produce a receipt", () => {
  assert.throws(
    () => createVerifiedProofReceipt(input({ tests: { passed: false, total: 12, failed: 1, command: "npm test" } })),
    /tests\.passed=true/
  );
});

test("tampered receipt fails verification", () => {
  const receipt = createVerifiedProofReceipt(input());
  assert.equal(verifyVerifiedProofReceipt({ ...receipt, decision: "BLOCKED" }), false);
});
