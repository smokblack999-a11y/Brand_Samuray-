"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessPatch, scoreEvidence, failureFingerprint } = require("./kill-critic");

test("scores weighted evidence deterministically", () => {
  assert.equal(scoreEvidence({
    exactErrorMatch: 1,
    stackTraceMatch: 1,
    changedFileMatch: 1,
    dependencyMatch: 1,
    historicalMatch: 1,
    reproducible: 1
  }), 1);
});

test("opens PR only after reproduction, causality, sandbox and CI evidence", () => {
  const result = assessPatch({
    errorType: "dependency_error",
    errorMessage: "module not found",
    changedFiles: ["package.json"],
    changedLines: 4,
    attempts: 0,
    risk: "low",
    reproduction: true,
    causality: true,
    sandboxPassed: true,
    ciPassed: true,
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      historicalMatch: 0.8,
      reproducible: 1
    }
  });

  assert.equal(result.action, "OPEN_PR");
  assert.ok(result.confidence >= 0.90);
  assert.equal(result.reasons.length, 0);
});

test("stops when evidence is weak", () => {
  const result = assessPatch({
    changedFiles: ["src/a.js"],
    reproduction: false,
    causality: false,
    sandboxPassed: false,
    ciPassed: false,
    evidence: { exactErrorMatch: 0.2 }
  });

  assert.equal(result.action, "STOP");
  assert.ok(result.reasons.includes("REPRODUCTION_REQUIRED"));
  assert.ok(result.reasons.includes("CAUSALITY_REQUIRED"));
});

test("refuses high-risk autonomous PRs", () => {
  const result = assessPatch({
    changedFiles: ["src/a.js"],
    changedLines: 10,
    risk: "high",
    reproduction: true,
    causality: true,
    sandboxPassed: true,
    ciPassed: true,
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      historicalMatch: 1,
      reproducible: 1
    }
  });

  assert.notEqual(result.action, "OPEN_PR");
  assert.ok(result.reasons.includes("RISK_TOO_HIGH"));
});

test("enforces patch size and retry budget", () => {
  const result = assessPatch({
    changedFiles: ["a.js"],
    changedLines: 251,
    attempts: 3,
    risk: "low",
    reproduction: true,
    causality: true,
    sandboxPassed: true,
    ciPassed: true,
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      historicalMatch: 1,
      reproducible: 1
    }
  });

  assert.equal(result.action, "STOP");
  assert.ok(result.reasons.includes("PATCH_TOO_LARGE"));
  assert.ok(result.reasons.includes("RETRY_BUDGET_EXHAUSTED"));
});

test("failure fingerprint is stable for equivalent evidence", () => {
  const a = failureFingerprint({
    errorType: "Test",
    exitCode: 1,
    failedCommand: "npm test",
    errorMessage: "FAIL",
    changedFiles: ["a.js"]
  });
  const b = failureFingerprint({
    errorType: "Test",
    exitCode: 1,
    failedCommand: "npm test",
    errorMessage: "FAIL",
    changedFiles: ["a.js"]
  });
  assert.equal(a, b);
});
