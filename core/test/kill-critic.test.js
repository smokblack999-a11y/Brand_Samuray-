const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIONS,
  fingerprint,
  scoreEvidence,
  riskLevel,
  decide
} = require("../kill-critic");

test("fingerprint is deterministic", () => {
  const input = {
    workflow: "CI",
    job: "test",
    step: "npm test",
    exitCode: 1,
    errorType: "test_failure",
    errorMessage: "Expected true",
    command: "npm test"
  };
  assert.equal(fingerprint(input), fingerprint(input));
  assert.match(fingerprint(input), /^[a-f0-9]{24}$/);
});

test("insufficient evidence stops before sandbox", () => {
  const result = decide({
    attempts: 0,
    evidence: {},
    patch: { changedFiles: 1, changedLines: 5 }
  });
  assert.equal(result.action, ACTIONS.STOP);
  assert.ok(result.reasons.includes("insufficient_root_cause_evidence"));
});

test("strong diagnosis can enter sandbox", () => {
  const result = decide({
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      historicalMatch: 0.5,
      scopeMatch: 1,
      sandboxPass: false,
      regressionPass: false
    },
    patch: { changedFiles: 1, changedLines: 20 }
  });
  assert.equal(result.action, ACTIONS.SANDBOX);
  assert.ok(result.score >= 0.75);
});

test("sandbox failure cannot become a PR", () => {
  const result = decide({
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      scopeMatch: 1,
      sandboxPass: false,
      regressionPass: false
    },
    patch: { changedFiles: 1, changedLines: 20 }
  });
  assert.notEqual(result.action, ACTIONS.CREATE_PR);
});

test("successful sandbox plus regression guard can create PR", () => {
  const result = decide({
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      historicalMatch: 1,
      scopeMatch: 1,
      sandboxPass: true,
      regressionPass: true
    },
    patch: { changedFiles: 2, changedLines: 40 }
  });
  assert.equal(result.action, ACTIONS.CREATE_PR);
  assert.equal(result.risk, "low");
  assert.equal(result.score, 1);
});

test("high-risk patch requires human review", () => {
  const result = decide({
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      sandboxPass: true,
      regressionPass: true
    },
    patch: { changedFiles: 2, changedLines: 20, sensitivePaths: ["package-lock.json"] }
  });
  assert.equal(result.action, ACTIONS.HUMAN_REVIEW);
  assert.equal(result.risk, "high");
});

test("retry budget stops autonomous recovery", () => {
  const result = decide({
    attempts: 3,
    evidence: {
      exactErrorMatch: 1,
      sandboxPass: true,
      regressionPass: true
    },
    patch: { changedFiles: 1, changedLines: 5 }
  });
  assert.equal(result.action, ACTIONS.STOP);
  assert.ok(result.reasons.includes("retry_budget_exhausted"));
});

test("risk engine detects oversized patches", () => {
  assert.equal(riskLevel({ changedFiles: 13, changedLines: 10 }), "high");
  assert.equal(riskLevel({ changedFiles: 2, changedLines: 300 }), "medium");
  assert.equal(riskLevel({ changedFiles: 2, changedLines: 20 }), "low");
});

test("score is bounded", () => {
  assert.equal(scoreEvidence({
    exactErrorMatch: 5,
    stackTraceMatch: 5,
    changedFileMatch: 5,
    dependencyMatch: 5,
    historicalMatch: 5,
    scopeMatch: 5,
    sandboxPass: true,
    regressionPass: true
  }), 1);
});
