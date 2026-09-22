"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVerifiedProofReceipt } = require("./nexus-proof-receipt");

function fixture(overrides = {}) {
  return {
    job: {
      jobId: "job-1",
      repository: "acme/app",
      baseSha: "base",
      patchSha: "patch",
      risk: "LOW"
    },
    diagnosis: {
      category: "test_failure",
      confidence: 0.98,
      fingerprint: "abc123"
    },
    proposal: {
      status: "PATCH_CANDIDATE",
      scope: { paths: ["src/math.js"], maxFiles: 3 },
      intent: "smallest testable patch"
    },
    critic: {
      decision: "PASS",
      evidenceHash: "c".repeat(64),
      failures: []
    },
    sandbox: {
      decision: "PASS",
      sandbox: {
        passed: true,
        commands: [{ command: "npm test", code: 0, passed: true }]
      }
    },
    tests: { passed: true, failed: 0 },
    security: "PASS",
    policy: "PASS",
    ...overrides
  };
}

test("creates a SHIP receipt only from complete evidence", () => {
  const receipt = createVerifiedProofReceipt(fixture());
  assert.equal(receipt.decision, "SHIP");
  assert.equal(receipt.humanRequired, false);
  assert.match(receipt.receiptHash, /^[a-f0-9]{64}$/);
});

test("same evidence produces the same receipt hash", () => {
  const a = createVerifiedProofReceipt(fixture());
  const b = createVerifiedProofReceipt(fixture());
  assert.deepEqual(a, b);
});

test("missing Kill Critic evidence is rejected", () => {
  assert.throws(
    () => createVerifiedProofReceipt(fixture({ critic: { decision: "PASS" } })),
    /Kill Critic PASS evidence/
  );
});

test("sandbox failure cannot produce proof", () => {
  assert.throws(
    () => createVerifiedProofReceipt(fixture({
      sandbox: { decision: "BLOCK", sandbox: { passed: false } }
    })),
    /sandbox PASS evidence/
  );
});

test("higher-risk changes require human review", () => {
  assert.throws(
    () => createVerifiedProofReceipt(fixture({ job: { ...fixture().job, risk: "HIGH" } })),
    /LOW risk/
  );
});
