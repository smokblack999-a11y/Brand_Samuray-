"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGithubPrAdapter } = require("./github-pr-adapter");

test("blocks PR without sandbox proof", async () => {
  const pr = createGithubPrAdapter({ create: async () => ({ number: 1 }) });
  await assert.rejects(() => pr({ mission: {}, execution: { testResult: { passed: false } } }), /pr_requires_sandbox_pass/);
});

test("delegates PR creation after sandbox proof", async () => {
  const pr = createGithubPrAdapter({ create: async x => ({ number: 2, mission: x.mission }) });
  const result = await pr({ mission: { id: "m1" }, execution: { testResult: { passed: true } } });
  assert.equal(result.number, 2);
});
