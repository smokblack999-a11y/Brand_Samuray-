const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeWorkflowRun,
  isRepairBranch,
  shouldRetry,
  buildProofReceipt
} = require("../recovery-router");

test("repair branch is recognized deterministically", () => {
  assert.equal(isRepairBranch("recovery/abc123"), true);
  assert.equal(isRepairBranch("main"), false);
  assert.equal(isRepairBranch("repair/abc123"), false);
});

test("retry budget is bounded", () => {
  assert.equal(shouldRetry(0), true);
  assert.equal(shouldRetry(2), true);
  assert.equal(shouldRetry(3), false);
});

test("successful workflow_run produces a proof receipt bound to the run", () => {
  const original = {
    fingerprint: "0123456789abcdef01234567",
    repository: "acme/app",
    branch: "recovery/0123456789abcdef01234567",
    repairHeadSha: "repair-sha",
    runId: 100,
  };
  const verification = {
    runId: 200,
    sha: "verified-sha"
  };
  const receipt = buildProofReceipt(original, verification, new Date("2026-09-22T12:00:00.000Z"));

  assert.equal(receipt.type, "x10think.recovery.proof");
  assert.equal(receipt.fingerprint, original.fingerprint);
  assert.equal(receipt.headSha, "repair-sha");
  assert.equal(receipt.workflowRunId, 100);
  assert.equal(receipt.verificationRunId, 200);
  assert.equal(receipt.gates.githubCi, true);
  assert.equal(receipt.gates.autonomousMerge, false);
});

test("workflow_run normalization preserves branch and SHA", () => {
  const job = normalizeWorkflowRun({
    repository: { full_name: "acme/app" },
    workflow_run: {
      id: 77,
      name: "CI",
      conclusion: "success",
      head_branch: "recovery/abc",
      head_sha: "deadbeef"
    }
  });
  assert.equal(job.branch, "recovery/abc");
  assert.equal(job.sha, "deadbeef");
  assert.equal(job.conclusion, "success");
});
