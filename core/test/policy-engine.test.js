"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyFiles, decide, createDecisionRecord } = require("../kill-critic/policy-engine");

test("classifies security-sensitive paths", () => {
  const result = classifyFiles(["src/auth/login.js", "src/crypto/key.js", ".github/workflows/ci.yml"]);
  assert.equal(result.highestRisk, "HIGH_RISK");
  assert.equal(result.findings.length, 3);
});

test("requires evidence before allowing a patch", () => {
  const result = decide({
    diff: "diff --git a/app.js b/app.js",
    files: ["app.js"],
    testsPassed: true,
    sandboxPassed: true,
    ciPassed: true
  });
  assert.equal(result.decision, "ESCALATE");
  assert.equal(result.reason, "REPRODUCTION_AND_CAUSALITY_REQUIRED");
});

test("quarantines high-risk changes until sandbox proof exists", () => {
  const result = decide({
    diff: "diff --git a/auth/login.js b/auth/login.js",
    files: ["auth/login.js"],
    reproduction: true,
    causality: true,
    testsPassed: true,
    ciPassed: true,
    sandboxPassed: false
  });
  assert.equal(result.decision, "QUARANTINE");
  assert.equal(result.state, "QUARANTINED");
});

test("verifies a normal evidence-backed patch only after all proof gates", () => {
  const result = decide({
    diff: "diff --git a/app.js b/app.js",
    files: ["app.js"],
    reproduction: true,
    causality: true,
    testsPassed: true,
    sandboxPassed: true,
    ciPassed: true
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.state, "VERIFIED");
});

test("creates deterministic audit evidence with a diff hash and decision hash", () => {
  const input = {
    jobId: "job-42",
    sourceSha: "abc123",
    policyVersion: "kc-policy-1",
    diff: "same diff",
    files: ["app.js"],
    reproduction: true,
    causality: true,
    testsPassed: true,
    sandboxPassed: true,
    ciPassed: true
  };
  const a = createDecisionRecord(input);
  const b = createDecisionRecord(input);
  assert.equal(a.diffSha256, b.diffSha256);
  assert.equal(a.decisionHash, b.decisionHash);
  assert.equal(a.decision, "ALLOW");
});
