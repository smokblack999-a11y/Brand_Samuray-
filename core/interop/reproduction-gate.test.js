"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReproductionPlan, evaluateReproduction } = require("./reproduction-gate");

test("reproduction plan uses the exact command from evidence", () => {
  const plan = buildReproductionPlan({
    evidenceOnly: true,
    workflowRunId: 42,
    category: "test_failure",
    command: ["npm", "test"]
  });
  assert.deepEqual(plan.command, ["npm", "test"]);
  assert.deepEqual(plan.required, ["baselineFailure", "patchedVerification"]);
});

test("reproduction plan rejects guessed commands when evidence has none", () => {
  assert.throws(
    () => buildReproductionPlan({ evidenceOnly: true, workflowRunId: 42, category: "test_failure" }),
    /exact reproduction command required/
  );
});

test("reproduction gate requires baseline failure and patched pass", () => {
  const plan = buildReproductionPlan({ evidenceOnly: true, workflowRunId: 42, category: "test_failure", command: ["npm", "test"] });
  const baseline = { isolated: true, verified: false, command: ["npm", "test"], category: "test_failure" };
  const patched = { isolated: true, verified: true, command: ["npm", "test"] };
  const result = evaluateReproduction(plan, baseline, patched);
  assert.equal(result.passed, true);
  assert.equal(result.reproduction, true);
  assert.equal(result.causality, true);
});

test("reproduction gate rejects a passing baseline", () => {
  const plan = buildReproductionPlan({ evidenceOnly: true, workflowRunId: 42, category: "syntax_error", command: ["node", "--check", "core/server.js"] });
  const baseline = { isolated: true, verified: true, command: ["node", "--check", "core/server.js"], category: "syntax_error" };
  const patched = { isolated: true, verified: true, command: ["node", "--check", "core/server.js"] };
  const result = evaluateReproduction(plan, baseline, patched);
  assert.equal(result.passed, false);
  assert.equal(result.causality, false);
});

test("reproduction gate rejects command substitution", () => {
  const plan = buildReproductionPlan({ evidenceOnly: true, workflowRunId: 42, category: "test_failure", command: ["npm", "test"] });
  const baseline = { isolated: true, verified: false, command: ["npm", "test"], category: "test_failure" };
  const patched = { isolated: true, verified: true, command: ["npm", "run", "test"] };
  const result = evaluateReproduction(plan, baseline, patched);
  assert.equal(result.passed, false);
  assert.equal(result.gates.sameCommand, false);
});
