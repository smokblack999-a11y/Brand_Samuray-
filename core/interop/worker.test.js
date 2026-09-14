"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { processJob } = require("./worker");

test("worker records strong log evidence but blocks patching without reproduction", async () => {
  const transitions = [];
  const result = await processJob({ id: "job-1", workflowRunId: 123 }, {
    diagnose: async () => ({
      workflowRunId: 123,
      failedJobs: [{ id: 1, name: "unit-tests", failedSteps: [{ name: "npm test", number: 2, conclusion: "failure" }], evidence: { excerpts: [{ line: 20, text: "AssertionError: expected 1 to equal 2" }] } }],
      category: "test_failure",
      confidence: "high",
      source: "github-actions-job-logs",
      evidenceOnly: true,
      credentialsRedacted: true,
      reproduction: false,
      causality: false
    }),
    transition: (id, stage, patch) => {
      transitions.push({ id, stage, patch });
      return { id, stage, ...patch };
    }
  });
  assert.equal(result.stage, "CRITIC_REVIEW");
  assert.equal(result.critic.passed, false);
  assert.equal(result.critic.readyForPatchCandidate, true);
  assert.equal(result.critic.gates.reproduction, false);
  assert.equal(result.critic.gates.causality, false);
  assert.deepEqual(transitions.map(x => x.stage), ["DIAGNOSING", "CRITIC_REVIEW"]);
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
