"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createX29Runtime } = require("./x29-runtime");

test("runtime never claims verified without sandbox and CI evidence", async () => {
  const saved = [];
  const queue = { complete(id, job) { saved.push({ id, job }); return job; } };
  const x28Adapter = {
    async plan() { return { x28: { job: { id: "job-1" } }, actions: ["diagnose"] }; },
    async criticEvaluate() { return { decision: "ALLOW", x28: { job: { state: "PATCHING", id: "job-1" } } }; },
    async recordSandboxTest({ testResult }) {
      return { job: { state: "PROVEN", id: "job-1" }, proof: { status: "PROVEN" }, testResult };
    },
    async openPullRequest({ provenJob, pullRequest }) {
      return { state: "PR_OPEN", id: provenJob.id, pullRequest };
    },
    async verifyPullRequest({ prJob, ciResult }) {
      return { state: ciResult.passed ? "VERIFIED" : "STOPPED", id: prJob.id };
    }
  };

  const runtime = createX29Runtime({
    queue,
    x28Adapter,
    candidateProvider: async () => ({
      rationale: "safe test candidate",
      changed_files: ["core/example.js"],
      changed_lines: 1,
      test_commands: ["node --check core/example.js"]
    }),
    sandbox: async () => ({ passed: true, command: "node --check core/example.js", exitCode: 0 }),
    pullRequest: async () => ({ number: 1 }),
    ciVerifier: async () => ({ passed: false, reason: "CI not observed" })
  });

  const result = await runtime.run({ id: "mission-1", type: "ci-repair", input: { workflowRun: { id: 1 } } });
  assert.notEqual(result.status, "PROVEN");
  assert.equal(saved.length, 0);
});

test("runtime escalates when no repair candidate exists", async () => {
  const saved = [];
  const queue = { complete(id, job) { saved.push(job); return job; } };
  const x28Adapter = {
    async plan() { return { x28: { job: { id: "job-2" } }, actions: [] }; }
  };
  const runtime = createX29Runtime({ queue, x28Adapter });
  const result = await runtime.run({ id: "mission-2", type: "ci-repair", input: {} });
  assert.equal(result.status, "ESCALATED");
});
