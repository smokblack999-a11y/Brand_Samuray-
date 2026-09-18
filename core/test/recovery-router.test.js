const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeWorkflowRun } = require("../recovery-router");

test("normalizes workflow_run into a deterministic recovery job key", () => {
  const job = normalizeWorkflowRun({
    repository: { full_name: "acme/app" },
    workflow_run: {
      id: 12345,
      name: "CI",
      conclusion: "failure",
      head_branch: "main",
      head_sha: "abc123"
    }
  });
  assert.equal(job.eventKey, "github:workflow_run:acme/app:12345");
  assert.equal(job.conclusion, "failure");
  assert.equal(job.sha, "abc123");
});

test("supports cancelled runs", () => {
  const job = normalizeWorkflowRun({
    repository: { full_name: "acme/app" },
    workflow_run: { id: 9, conclusion: "cancelled" }
  });
  assert.equal(job.conclusion, "cancelled");
});
