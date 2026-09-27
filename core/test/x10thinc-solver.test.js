"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { solveRecovery } = require("../x10thinc-solver");
const { ACTIONS } = require("../kill-critic");

test("unsafe semantic diff fails closed", () => {
  const r = solveRecovery({
    attempts: 0,
    diagnosis: {
      errorType: "syntax_error",
      affectedFiles: ["core/app.js"],
      evidence: {
        exactErrorMatch: 0.8,
        stackTraceMatch: 0.7,
        changedFileMatch: 1,
        dependencyMatch: 0,
        historicalMatch: 0,
        scopeMatch: 1,
        sandboxPass: true,
        regressionPass: true
      }
    },
    patch: {
      files: ["core/app.js"],
      changedFiles: 1,
      changedLines: 1,
      diff: '+++ b/core/app.js\n+const api_key = "sk-test-1234567890";'
    }
  });
  assert.notEqual(r.action, ACTIONS.CREATE_PR);
  assert.ok(r.reasons.includes("SEMANTIC_DIFF_RISK"));
});

test("safe patch can reach PR gate only with strong evidence", () => {
  const r = solveRecovery({
    attempts: 0,
    diagnosis: {
      errorType: "syntax_error",
      affectedFiles: ["core/app.js"],
      evidence: {
        exactErrorMatch: 1,
        stackTraceMatch: 1,
        changedFileMatch: 1,
        dependencyMatch: 0,
        historicalMatch: 1,
        scopeMatch: 1,
        sandboxPass: true,
        regressionPass: true
      }
    },
    patch: {
      files: ["core/app.js"],
      changedFiles: 1,
      changedLines: 1,
      diff: '+++ b/core/app.js\n+const fixed = true;'
    }
  });
  assert.equal(r.action, ACTIONS.CREATE_PR);
});
