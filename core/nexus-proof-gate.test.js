"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createProofGate } = require("./nexus-proof-gate");

const base = {
  jobId: "job-1",
  repository: "acme/app",
  headSha: "head",
  diagnosis: { category: "test_failure", confidence: 0.99, fingerprint: "fp" },
  proposal: { status: "PATCH_CANDIDATE", scope: { paths: ["src/a.js"], maxFiles: 3 } },
  critic: { decision: "PASS", evidenceHash: "a".repeat(64) },
  sandbox: { passed: true, commands: [{ code: 0, passed: true }] },
  tests: { passed: true, failed: 0, total: 1, command: "npm test" },
  security: "PASS",
  policy: "PASS"
};

test("proof gate emits SHIP only with a verified receipt", () => {
  const result = createProofGate() (base);
  assert.equal(result.status, "PROOF_READY");
  assert.equal(result.decision, "SHIP");
  assert.match(result.receipt.receiptHash, /^[a-f0-9]{64}$/);
});

test("proof gate blocks missing policy evidence", () => {
  const result = createProofGate()({ ...base, policy: "FAIL" });
  assert.equal(result.status, "HUMAN_REVIEW");
  assert.equal(result.decision, "BLOCK");
});

test("proof gate never promotes a failed sandbox", () => {
  const result = createProofGate()({ ...base, sandbox: { passed: false, commands: [] } });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.decision, "BLOCK");
});
