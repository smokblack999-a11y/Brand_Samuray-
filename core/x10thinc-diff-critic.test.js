"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeDiff } = require("./x10thinc-diff-critic");
const { solveRecovery } = require("./x10thinc-solver");

test("semantic critic catches added secret literals", () => {
  const result = analyzeDiff('diff --git a/core/a.js b/core/a.js\n+++ b/core/a.js\n+const apiKey = "123456789abcdef";');
  assert.equal(result.safe, false);
  assert.ok(result.criticalCount >= 1);
});

test("semantic critic catches deleted assertions", () => {
  const result = analyzeDiff('diff --git a/core/a.test.js b/core/a.test.js\n+++ b/core/a.test.js\n-assert.equal(value, true);\n+console.log(value);');
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes("TEST_ASSERTION_DELETED"));
});

test("semantic critic catches auth bypass patterns", () => {
  const result = analyzeDiff('diff --git a/core/auth.js b/core/auth.js\n+++ b/core/auth.js\n+function verify() { return true; }');
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes("CRITICAL_DIFF_PATTERN"));
});

test("safe diff remains eligible for the deterministic solver", () => {
  const diff = 'diff --git a/core/app.js b/core/app.js\n+++ b/core/app.js\n+const answer = 42;\n';
  const verdict = solveRecovery({
    attempts: 0,
    diagnosis: {
      affectedFiles: ["core/app.js"],
      evidence: {
        exactErrorMatch: 1, stackTraceMatch: 1, changedFileMatch: 1,
        dependencyMatch: 1, historicalMatch: 1, scopeMatch: 1,
        sandboxPass: true, regressionPass: true
      }
    },
    patch: { files:["core/app.js"], changedFiles:1, changedLines:1, deletions:0, diff }
  });
  assert.equal(verdict.diffCritic.safe, true);
  assert.equal(verdict.action, "CREATE_PR");
});
