"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStore } = require("./nexus-job-store");
const { normalizeWorkflowRun } = require("./nexus-workflow-intake");
const { handleWorkflowRun } = require("./nexus-webhook");

function payload(id = 123) {
  return {
    action: "completed",
    repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
    workflow_run: {
      id,
      name: "core",
      conclusion: "failure",
      head_sha: "abc123",
      head_branch: "feature/test",
      html_url: `https://github.com/run/${id}`
    }
  };
}

test("workflow_run failure becomes deterministic queue job", () => {
  const job = normalizeWorkflowRun(payload(123));
  assert.equal(job.repository, "smokblack999-a11y/Brand_Samuray-");
  assert.equal(job.runId, "123");
  assert.equal(job.status, "QUEUED");
  assert.match(job.jobId, /^gh-/);
});

test("store survives a new store instance and deduplicates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-"));
  const file = path.join(dir, "jobs.json");
  const storeA = createStore(file);
  const result = handleWorkflowRun(payload(7), storeA);
  assert.equal(result.accepted, true);
  assert.equal(storeA.list({ status: "QUEUED" }).length, 1);

  const storeB = createStore(file);
  assert.equal(storeB.get(result.job.jobId).runId, "7");
  const duplicate = handleWorkflowRun(payload(7), storeB);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate");

  fs.rmSync(dir, { recursive: true, force: true });
});
