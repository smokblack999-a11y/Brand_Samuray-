"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createJob,
  canTransition,
  transition,
  kill,
  evidencePass,
  criticPass,
  evaluateGate,
  createProofReceipt,
  canonicalJson,
  sha256
} = require("./proof-engine");

const critic = { correctness: "PASS", regression: "PASS", security: "PASS", scope: "PASS" };
const evidence = [{ command: "npm test", exitCode: 0, logHash: sha256("PASS"), commitSha: "abc123" }];

test("state machine rejects skipping verification", () => {
  const job = createJob({ repository: "acme/app", baseSha: "base" });
  assert.equal(canTransition("RECEIVED", "SHIP"), false);
  assert.throws(() => transition(job, "SHIP"), /Invalid NEXUS transition/);
});

test("state machine follows controlled path", () => {
  let job = createJob({ repository: "acme/app", baseSha: "base" });
  for (const state of ["TRIAGED", "DIAGNOSED", "PATCHING", "SANDBOX", "TESTING", "CRITIC", "SECURITY", "POLICY", "PROOF", "SHIP"]) {
    job = transition(job, state);
  }
  assert.equal(job.state, "SHIP");
});

test("kill is terminal and records reason", () => {
  const job = createJob({ repository: "acme/app" });
  const killed = kill(job, "security anomaly");
  assert.equal(killed.state, "KILLED");
  assert.equal(killed.killed, true);
  assert.equal(killed.killReason, "security anomaly");
});

test("evidence requires successful command, log hash and commit", () => {
  assert.equal(evidencePass(evidence[0]), true);
  assert.equal(evidencePass({ command: "npm test", exitCode: 1, logHash: "x", commitSha: "abc" }), false);
});

test("critic requires all independent dimensions", () => {
  assert.equal(criticPass(critic), true);
  assert.equal(criticPass({ ...critic, security: "FAIL" }), false);
});

test("low-risk fully evidenced change can ship", () => {
  const gate = evaluateGate({ risk: "LOW", evidence, critic, security: "PASS", policy: "PASS" });
  assert.equal(gate.approved, true);
  assert.equal(gate.decision, "SHIP");
});

test("high-risk change requires human review even with green evidence", () => {
  const gate = evaluateGate({ risk: "HIGH", evidence, critic, security: "PASS", policy: "PASS" });
  assert.equal(gate.approved, false);
  assert.equal(gate.decision, "HUMAN_REVIEW");
  assert.equal(gate.humanRequired, true);
});

test("missing evidence blocks shipping", () => {
  const gate = evaluateGate({ risk: "LOW", evidence: [], critic, security: "PASS", policy: "PASS" });
  assert.equal(gate.decision, "BLOCKED");
});

test("proof receipt is deterministic-hashable and contains decision", () => {
  const job = createJob({ jobId: "job-1", repository: "acme/app", baseSha: "base", patchSha: "patch" });
  const receipt = createProofReceipt({ job, evidence, critic, security: "PASS", policy: "PASS", tests: { passed: 10, failed: 0 } });
  assert.match(receipt.proofId, /^NXS-/);
  assert.equal(receipt.decision, "SHIP");
  assert.match(receipt.receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});
