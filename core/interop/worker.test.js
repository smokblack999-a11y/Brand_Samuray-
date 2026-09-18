"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { processJob } = require("./worker");

function evidence(workflowRunId) {
  return {
    workflowRunId,
    command: ["npm", "test"],
    failedJobs: [{ id: 1, name: "unit-tests", command: ["npm", "test"], failedSteps: [{ name: "npm test", number: 2, conclusion: "failure" }], evidence: { excerpts: [{ line: 20, text: "AssertionError: expected 1 to equal 2" }] } }],
    category: "test_failure",
    confidence: "high",
    source: "github-actions-job-logs",
    evidenceOnly: true,
    credentialsRedacted: true,
    reproduction: false,
    causality: false
  };
}

test("worker records strong log evidence but blocks patching without executed reproduction", async () => {
  const transitions = [];
  const result = await processJob({ id: "job-1", workflowRunId: 123 }, {
    diagnose: async () => evidence(123),
    transition: (id, stage, patch) => {
      transitions.push({ id, stage, patch });
      return { id, stage, ...patch };
    }
  });
  assert.equal(result.stage, "CRITIC_REVIEW");
  assert.equal(result.critic.passed, false);
  assert.equal(result.critic.readyForPatchCandidate, false);
  assert.equal(result.critic.gates.reproduction, false);
  assert.equal(result.critic.gates.causality, false);
  assert.equal(result.repairPlan.patchCandidateAllowed, false);
  assert.equal(result.patchCandidate.accepted, false);
  assert.deepEqual(result.reproductionPlan.command, ["npm", "test"]);
  assert.equal(result.reproductionProof, null);
  assert.deepEqual(transitions.map(x => x.stage), ["DIAGNOSING", "CRITIC_REVIEW"]);
});

test("worker accepts patch candidate only after executing reproduction", async () => {
  const result = await processJob({ id: "job-verified-evidence", workflowRunId: 456 }, {
    diagnose: async () => evidence(456),
    workspace: "/tmp/repro-workspace",
    patch: "--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-fail\n+pass\n",
    runReproduction: async ({ workspace, plan, patch }) => {
      assert.equal(workspace, "/tmp/repro-workspace");
      assert.deepEqual(plan.command, ["npm", "test"]);
      assert.ok(patch);
      return { reproduction: true, causality: true, passed: true, gates: { sameCommand: true } };
    },
    transition: (id, stage, patch) => ({ id, stage, ...patch })
  });
  assert.equal(result.critic.readyForPatchCandidate, true);
  assert.equal(result.reproductionProof.passed, true);
  assert.equal(result.repairPlan.patchCandidateAllowed, true);
  assert.equal(result.patchCandidate.accepted, true);
  assert.equal(result.repairPlan.automaticWriteAllowed, false);
  assert.equal(result.repairPlan.automaticMergeAllowed, false);
});

test("worker refuses jobs without workflow run evidence", async () => {
  const result = await processJob({ id: "job-2" }, {
    transition: (id, stage, patch) => ({ id, stage, ...patch })
  });
  assert.equal(result.stage, "HUMAN_REVIEW");
  assert.equal(result.reason, "MISSING_WORKFLOW_RUN_ID");
});

test("worker sends missing GitHub auth to human review", async () => {
  const result = await processJob({ id: "job-3", workflowRunId: 456 }, {
    diagnose: async () => { throw new Error("GITHUB_TOKEN is required"); },
    transition: (id, stage, patch) => ({ id, stage, ...patch })
  });
  assert.equal(result.stage, "HUMAN_REVIEW");
  assert.equal(result.reason, "GITHUB_AUTH_NOT_CONFIGURED");
});

test("worker provisions the failed commit when a patch is available", async () => {
  let provisionArgs = null;
  let cleaned = false;
  const sha = "b".repeat(40);
  const result = await processJob({ id: "job-provision", workflowRunId: 789, commit: sha, repository: "acme/site" }, {
    diagnose: async () => evidence(789),
    patch: "--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-fail\n+pass\n",
    provisionWorkspace: async args => {
      provisionArgs = args;
      return { workspace: "/tmp/isolated/repo", cleanup: async () => { cleaned = true; } };
    },
    runReproduction: async ({ workspace, plan, patch }) => {
      assert.equal(workspace, "/tmp/isolated/repo");
      assert.deepEqual(plan.command, ["npm", "test"]);
      assert.ok(patch);
      return { reproduction: true, causality: true, passed: true, gates: { sameCommand: true } };
    },
    transition: (id, stage, patch) => ({ id, stage, ...patch })
  });
  assert.equal(provisionArgs.repository, "acme/site");
  assert.equal(provisionArgs.headSha, sha);
  assert.equal(result.repairPlan.patchCandidateAllowed, true);
  assert.equal(cleaned, true);
});

test("worker refuses a job without an exact commit SHA", async () => {
  const result = await processJob({ id: "job-no-sha", workflowRunId: 790, repository: "acme/site" }, {
    transition: (id, stage, patch) => ({ id, stage, ...patch })
  });
  assert.equal(result.stage, "HUMAN_REVIEW");
  assert.equal(result.reason, "MISSING_EXACT_COMMIT_SHA");
});


test("worker requires a real patch proposal provider", async () => {
  const result = await processJob({
    id: "job-no-proposal",
    workflowRunId: 791,
    commit: "c".repeat(40),
    repository: "acme/site"
  }, {
    diagnose: async () => evidence(791),
    transition: (id, stage, patch) => ({ id, stage, ...patch })
  });
  assert.equal(result.stage, "HUMAN_REVIEW");
  assert.equal(result.reason, "PATCH_PROPOSAL_PROVIDER_REQUIRED");
});
