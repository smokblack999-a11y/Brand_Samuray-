"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runVerification, buildEvidence } = require("./nexus-controller");

const critic = { correctness: "PASS", regression: "PASS", security: "PASS", scope: "PASS" };

test("controller produces a proof receipt for an eligible low-risk patch", () => {
  const result = runVerification({
    repository: "acme/app",
    baseSha: "base123",
    patchSha: "patch123",
    changedFiles: ["src/math.js"],
    evidence: [buildEvidence({ command: "npm test", exitCode: 0, log: "184 passed", commitSha: "patch123" })],
    critic,
    security: "PASS",
    policy: "PASS",
    tests: { passed: 184, failed: 0 }
  });
  assert.equal(result.job.state, "POLICY");
  assert.equal(result.policy.decision, "SHIP");
  assert.equal(result.receipt.decision, "SHIP");
  assert.match(result.receipt.receiptHash, /^[a-f0-9]{64}$/);
});

test("controller cannot ship a privileged workflow change", () => {
  const result = runVerification({
    repository: "acme/app",
    changedFiles: [".github/workflows/deploy.yml"],
    evidence: [buildEvidence({ command: "npm test", exitCode: 0, log: "pass", commitSha: "patch" })],
    critic,
    security: "PASS",
    policy: "PASS"
  });
  assert.equal(result.policy.risk, "CRITICAL");
  assert.equal(result.policy.decision, "HUMAN_REVIEW");
});
