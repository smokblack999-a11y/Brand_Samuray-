"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { solveRecovery, contradictionCheck, protectedPaths } = require("./x10thinc-solver");

const baseDiagnosis = {
  fingerprint: "a".repeat(24),
  errorType: "dependency_error",
  affectedFiles: ["core/app.js"],
  evidence: {
    exactErrorMatch: 0.8,
    stackTraceMatch: 0.7,
    changedFileMatch: 1,
    dependencyMatch: 0.9,
    historicalMatch: 0,
    scopeMatch: 1,
    sandboxPass: true,
    regressionPass: true
  }
};

test("X10THINC is deterministic and produces a bounded confidence", () => {
  const input = {
    attempts: 0,
    diagnosis: baseDiagnosis,
    patch: { files: ["core/app.js"], changedFiles: 1, changedLines: 8, deletions: 2 }
  };
  const a = solveRecovery(input);
  const b = solveRecovery(input);
  assert.equal(a.stateHash, b.stateHash);
  assert.equal(a.engine, "X10THINC");
  assert.equal(a.confidence >= 0 && a.confidence <= 1, true);
});

test("X10THINC blocks a patch outside diagnosed scope", () => {
  const verdict = solveRecovery({
    diagnosis: baseDiagnosis,
    patch: { files: ["core/unrelated.js"], changedFiles: 1, changedLines: 3 }
  });
  assert.equal(verdict.action, "STOP");
  assert.equal(verdict.reasons.includes("PATCH_OUTSIDE_DIAGNOSED_SCOPE"), true);
});

test("X10THINC routes protected paths to human review", () => {
  const files = ["core/auth/session.js"];
  assert.deepEqual(protectedPaths(files), files);
  const verdict = solveRecovery({
    diagnosis: { ...baseDiagnosis, affectedFiles: files },
    patch: { files, changedFiles: 1, changedLines: 5 }
  });
  assert.equal(verdict.action, "HUMAN_REVIEW");
  assert.equal(verdict.reasons.includes("PROTECTED_PATH"), true);
});

test("X10THINC detects contradictory evidence", () => {
  const contradictions = contradictionCheck({
    exactErrorMatch: 0.8,
    stackTraceMatch: 0,
    dependencyMatch: 0,
    changedFileMatch: 1,
    scopeMatch: 1,
    sandboxPass: false,
    regressionPass: true
  });
  assert.equal(contradictions.includes("REGRESSION_WITHOUT_SANDBOX"), true);
});
