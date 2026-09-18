"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { relevantRuns } = require("./github-agent-pr-verifier");

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
