"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { relevantRuns, relevantCheckRuns, checkRunFailures } = require("./github-agent-pr-verifier");

test("relevantRuns only keeps the target PR head SHA", () => {
  const result = relevantRuns([
    { id: 1, name: "Core CI", head_sha: "abc", status: "completed", conclusion: "success" },
    { id: 2, name: "Core CI", head_sha: "def", status: "completed", conclusion: "failure" }
  ], "abc");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test("relevantRuns ignores the agent's own workflow", () => {
  const result = relevantRuns([
    { id: 1, name: "SamuraiOS X18 Agent", head_sha: "abc", status: "completed", conclusion: "failure" },
    { id: 2, name: "Build SamuraiOS APK", head_sha: "abc", status: "completed", conclusion: "success" }
  ], "abc");
  assert.deepEqual(result.map(x => x.id), [2]);
});

test("relevantCheckRuns only keeps the target SHA and excludes the agent", () => {
  const result = relevantCheckRuns([
    { id: 1, name: "Core CI", app: { name: "GitHub Actions" }, head_sha: "abc" },
    { id: 2, name: "Other SHA", app: { name: "GitHub Actions" }, head_sha: "def" },
    { id: 3, name: "SamuraiOS X18 Agent", app: { name: "SamuraiOS X18 Agent" }, head_sha: "abc" }
  ], "abc");
  assert.deepEqual(result.map(x => x.id), [1]);
});

test("checkRunFailures treats non-success completed conclusions as failures", () => {
  const result = checkRunFailures([
    { id: 1, status: "completed", conclusion: "success" },
    { id: 2, status: "completed", conclusion: "neutral" },
    { id: 3, status: "completed", conclusion: "skipped" },
    { id: 4, status: "completed", conclusion: "failure" },
    { id: 5, status: "in_progress", conclusion: null }
  ]);
  assert.deepEqual(result.map(x => x.id), [4]);
});


test("shouldRetryChecks only retries completed failures", () => {
  const { shouldRetryChecks } = require("./github-agent-pr-verifier");
  assert.equal(shouldRetryChecks({ pending: 0, failures: [{ name: "Core CI", conclusion: "failure" }] }), true);
  assert.equal(shouldRetryChecks({ pending: 1, failures: [{ name: "Core CI", conclusion: "failure" }] }), false);
  assert.equal(shouldRetryChecks({ pending: 0, failures: [] }), false);
});
