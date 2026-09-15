"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-x18-worker-"));
process.env.DATA_DIR = dir;

const githubAgent = require("./github-agent");
const { buildTask, processNext } = require("./github-agent-worker");

function payload(id = 123) {
  return {
    action: "completed",
    repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
    workflow_run: {
      id,
      run_attempt: 1,
      name: "core",
      head_branch: "repair-source",
      head_sha: "abc123",
      conclusion: "failure",
      status: "completed",
      html_url: `https://github.com/smokblack999-a11y/Brand_Samuray-/actions/runs/${id}`
    }
  };
}

test("buildTask forbids invented execution claims", () => {
  const task = buildTask({ id: "job-1", repository: "owner/repo", runId: 1 }, { failedJobs: [] });
  assert.match(task, /ONLY the supplied evidence/i);
  assert.match(task, /Do not claim that a file was edited/i);
  assert.match(task, /separate branch/i);
});

test("worker claims, diagnoses, and persists verified diagnosis", async () => {
  const ingested = githubAgent.ingestWorkflowRun(payload(321), "delivery-321");
  assert.equal(ingested.accepted, true);

  const result = await processNext({
    evidenceProvider: async job => ({ failedJobs: [{ id: 9, name: "test", logs: "AssertionError: expected 2 to equal 3" }], job }),
    ai: async () => ({
      status: "verified",
      confidence: 0.94,
      issues: [],
      finalAnswer: JSON.stringify({ root_cause: "test assertion mismatch", patch_ready: false }),
      messages: []
    })
  });

  assert.equal(result.processed, true);
  assert.equal(result.state, "diagnosed");
  const stored = githubAgent.list(10).find(item => item.id === result.jobId);
  assert.equal(stored.state, "diagnosed");
  assert.equal(stored.diagnosis.confidence, 0.94);
});
