"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ac = require("./agent-control");

test("classifies failed test workflow as evidence-gated CI failure", () => {
  const result = ac.classifyFailure({ name: "SamuraiOS Core CI", conclusion: "failure" });
  assert.equal(result.category, "ci_failure");
  assert.equal(result.evidenceRequired, true);
});

test("does not classify success as failure", () => {
  const result = ac.classifyFailure({ name: "Build", conclusion: "success" });
  assert.equal(result.category, "none");
});

test("verifies GitHub HMAC SHA-256 signatures", () => {
  const crypto = require("node:crypto");
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "test-secret";
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(ac.verifyGithubSignature(body, signature, secret), true);
  assert.equal(ac.verifyGithubSignature(body, signature, "wrong"), false);
});

test("requires reproduction and causality before repair eligibility", () => {
  const job = {
    id: "test-job",
    state: "EVIDENCE_PENDING",
    classification: { category: "ci_failure" }
  };
  const first = ac.diagnose(job, { logs: "AssertionError: expected 1", reproduction: true, causality: false });
  assert.equal(first.state, "EVIDENCE_PENDING");

  const second = ac.diagnose(job, { logs: "AssertionError: expected 1", reproduction: true, causality: true });
  assert.equal(second.state, "REPAIR_ELIGIBLE");
});
