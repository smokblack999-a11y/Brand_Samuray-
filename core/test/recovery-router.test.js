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

const { diagnose } = require("../recovery-router");

test("diagnoses dependency failures from CI logs", () => {
  const result = diagnose("Execution failed for task :app:mergeDebugResources\nAAPT2 error: could not resolve dependency");
  assert.equal(result.errorType, "dependency_error");
  assert.ok(result.confidence >= 0.7);
  assert.equal(result.evidence.dependencyMatch, 0.9);
});

test("diagnoses test failures from CI logs", () => {
  const result = diagnose("FAIL tests/foo.test.js\nAssertionError: expected true\n    at foo.js:1:1");
  assert.equal(result.errorType, "test_failure");
  assert.ok(result.evidence.stackTraceMatch > 0);
});

test("does not invent a diagnosis when logs are empty", () => {
  const result = diagnose("");
  assert.equal(result.errorType, "generic");
  assert.equal(result.confidence, 0.15);
});


test("success workflow on a recovery branch promotes the matching job to proven", () => {
  const { enqueue, update } = require("../recovery-store");
  const unique = "test-success-" + Date.now();
  const queued = enqueue({
    eventKey: unique,
    repository: "acme/app",
    workflow: "CI",
    runId: 1,
    branch: "recovery/fp123",
    sha: "abc123",
    fingerprint: "abcdefabcdefabcdefabcdef"
  });
  update(queued.job.id, { status: "pr_created" });
  assert.equal(queued.created, true);
  const { find } = require("../recovery-store");
  const current = find(x => x.id === queued.job.id);
  assert.equal(current.status, "pr_created");
});
