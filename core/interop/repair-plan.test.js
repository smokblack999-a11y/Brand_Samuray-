"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRepairPlan } = require("./repair-plan");

function evidence(category, extra = {}) {
  return {
    category,
    evidenceOnly: true,
    failedJobs: [{
      id: 42,
      name: "ci",
      evidence: { excerpts: [{ line: 10, text: "first actionable error" }] }
    }],
    reproduction: false,
    causality: false,
    ...extra
  };
}

test("dependency diagnosis produces bounded repair playbook", () => {
  const plan = buildRepairPlan(evidence("dependency_error"));
  assert.equal(plan.category, "dependency_error");
  assert.equal(plan.patchCandidateAllowed, false);
  assert.equal(plan.automaticWriteAllowed, false);
  assert.ok(plan.checks.includes("prefer the smallest lockfile/manifest change"));
  assert.equal(plan.evidenceRefs[0].jobId, 42);
});

test("generic diagnosis refuses to guess a patch", () => {
  const plan = buildRepairPlan(evidence("generic"));
  assert.equal(plan.patchCandidateAllowed, false);
  assert.ok(plan.checks.includes("establish causality"));
  assert.ok(plan.forbidden.includes("guess a fix from the final log line"));
});

test("reproduction plus causality unlock only a patch candidate, never automatic writes", () => {
  const plan = buildRepairPlan(evidence("test_failure", { reproduction: true, causality: true }));
  assert.equal(plan.patchCandidateAllowed, true);
  assert.equal(plan.automaticWriteAllowed, false);
  assert.equal(plan.automaticMergeAllowed, false);
});

test("non evidence-only input is rejected", () => {
  assert.throws(() => buildRepairPlan({ category: "test_failure", evidenceOnly: false }), /evidence-only diagnosis is required/);
});
