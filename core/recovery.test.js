"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("./recovery/kill-critic");
const { normalizeWorkflowFailure, isRecoverableFailure } = require("./recovery/github");
const { canTransition } = require("./recovery/state");

test("Kill Critic rejects incomplete recovery", () => {
  const result = evaluate({ patchApplied: true, sandboxPassed: true, testsPassed: true, ciPassed: false });
  assert.equal(result.decision, "human_review");
});

test("Kill Critic accepts only fully verified recovery", () => {
  const result = evaluate({ patchApplied: true, sandboxPassed: true, testsPassed: true, ciPassed: true, filesChanged: ["a.js"] });
  assert.equal(result.decision, "recovered");
});

test("GitHub workflow failure is normalized", () => {
  const result = normalizeWorkflowFailure({ repository: { full_name: "o/r" }, workflow_run: { id: 42, name: "CI", conclusion: "failure", head_sha: "abc" } });
  assert.equal(result.repo, "o/r");
  assert.equal(result.runId, "42");
  assert.equal(isRecoverableFailure({ repository: { full_name: "o/r" }, workflow_run: { id: 42, conclusion: "failure" } }), true);
});

test("terminal recovery states cannot transition", () => {
  assert.equal(canTransition("recovered", "running"), false);
  assert.equal(canTransition("frozen", "running"), false);
});

const { buildPrRequest } = require("./recovery/github-pr");
const { evaluate: evaluateCritic } = require("./recovery/kill-critic");
test("recovery budget freezes over runtime", () => { assert.equal(evaluateCritic({ patchApplied:true, sandboxPassed:true, testsPassed:true, ciPassed:true, runtimeSeconds:901, maxRuntimeSeconds:900 }).decision, "frozen"); });
test("PR request has no token field", () => { const r=buildPrRequest({source:{repo:"o/r",sha:"abc"}},{branch:"recovery/a",title:"fix",body:"proof"}); assert.equal("token" in r,false); });
