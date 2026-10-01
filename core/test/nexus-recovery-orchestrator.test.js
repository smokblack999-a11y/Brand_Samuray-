"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { executeRecovery } = require("../nexus-recovery-orchestrator");

const input = {
  resource: "github://repo/workflow/build",
  workflow: { id: 123, conclusion: "failure" },
  diagnosis: { reproduction: true, causality: true },
  changedFiles: ["src/service.js"],
  proposal: {
    diff: "--- a/src/service.js\n+++ b/src/service.js\n@@ -1 +1 @@\n+safeFix();"
  }
};

test("orchestrator refuses missing real adapters", async () => {
  await assert.rejects(
    () => executeRecovery(input, {}),
    /transport_method_required:createRepairBranch/
  );
});

test("orchestrator runs adapter contract and ends review-gated", async () => {
  const calls = [];
  const adapters = {
    github: {
      async createRepairBranch(x) { calls.push(["branch", x]); return "x10think/recovery-123"; },
      async applyPatch(x) { calls.push(["patch", x]); return { success: true, afterSha: "after-sha" }; },
      async createPullRequest(x) { calls.push(["pr", x]); return { created: true, number: 99, draft: x.draft }; }
    },
    sandbox: {
      async run(x) { calls.push(["sandbox", x]); return { passed: true }; }
    },
    ci: {
      async waitForResult(x) {
        calls.push(["ci", x]);
        return { passed: true, testsPassed: true, invariantsPassed: true, runId: 456 };
      }
    }
  };

  const result = await executeRecovery(input, adapters);

  assert.equal(result.phase, "READY_FOR_REVIEW");
  assert.equal(result.pr.draft, true);
  assert.equal(result.proof.schema, "nexus-recovery-proof/v1");
  assert.equal(result.proof.afterSha, "after-sha");
  assert.deepEqual(calls.map(x => x[0]), ["branch", "patch", "sandbox", "ci", "pr"]);
});

test("dangerous proposal never reaches adapters", async () => {
  let invoked = false;
  const adapters = {
    github: {
      async createRepairBranch() { invoked = true; },
      async applyPatch() {},
      async createPullRequest() {}
    },
    sandbox: { async run() {} },
    ci: { async waitForResult() {} }
  };

  const result = await executeRecovery({
    ...input,
    proposal: {
      diff: "--- a/src/service.js\n+++ b/src/service.js\n@@ -1 +1 @@\n+rm -rf /"
    }
  }, adapters);

  assert.equal(result.phase, "BLOCKED");
  assert.equal(invoked, false);
});
