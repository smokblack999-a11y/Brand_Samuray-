"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGithubSandboxAdapter } = require("./github-sandbox-adapter");

function githubStub({ comparison }) {
  const calls = [];
  return {
    calls,
    async createBranch(input) { calls.push(["branch", input]); },
    async upsertFile(input) { calls.push(["file", input]); },
    async compareBranches() { calls.push(["compare"]); return comparison; },
    async listWorkflowRuns() {
      calls.push(["runs"]);
      return { workflow_runs: [{
        id: 77,
        path: ".github/workflows/core.yml",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/example/run/77"
      }] };
    }
  };
}

test("rejects actual diff above policy before sandbox PASS", async () => {
  const github = githubStub({
    comparison: {
      files: Array.from({ length: 9 }, (_, i) => ({
        filename: `core/f${i}.js`,
        additions: 1,
        deletions: 0
      }))
    }
  });
  const runSandbox = createGithubSandboxAdapter({ github, pollMs: 0, timeoutMs: 1000 });
  const result = await runSandbox({
    mission: { input: { workflowRun: { repository: { default_branch: "main" } } } },
    candidate: {
      branch: "x29/test-diff",
      changed_files: ["core/f0.js"],
      changed_lines: 1,
      files: [{ path: "core/f0.js", content: "module.exports = 1;\n" }]
    }
  });
  assert.equal(result.passed, false);
  assert.equal(result.reason, "sandbox_diff_policy_failed");
  assert.equal(github.calls.some(call => call[0] === "runs"), false);
});

test("requires declared paths to match actual GitHub diff", async () => {
  const github = githubStub({
    comparison: {
      files: [{ filename: "core/actual.js", additions: 1, deletions: 0 }]
    }
  });
  const runSandbox = createGithubSandboxAdapter({ github, pollMs: 0, timeoutMs: 1000 });
  const result = await runSandbox({
    mission: { input: { workflowRun: { repository: { default_branch: "main" } } } },
    candidate: {
      branch: "x29/test-mismatch",
      changed_files: ["core/declared.js"],
      changed_lines: 1,
      files: [{ path: "core/declared.js", content: "module.exports = 1;\n" }]
    }
  });
  assert.equal(result.passed, false);
  assert.equal(result.reason, "sandbox_declared_diff_mismatch");
});

test("returns PASS only after successful repository CI", async () => {
  const github = githubStub({
    comparison: {
      files: [{ filename: "core/example.js", additions: 1, deletions: 0 }]
    }
  });
  const runSandbox = createGithubSandboxAdapter({ github, pollMs: 0, timeoutMs: 1000 });
  const result = await runSandbox({
    mission: { input: { workflowRun: { repository: { default_branch: "main" } } } },
    candidate: {
      branch: "x29/test-pass",
      changed_files: ["core/example.js"],
      changed_lines: 1,
      files: [{ path: "core/example.js", content: "module.exports = 1;\n" }]
    }
  });
  assert.equal(result.passed, true);
  assert.equal(result.run.id, 77);
});
