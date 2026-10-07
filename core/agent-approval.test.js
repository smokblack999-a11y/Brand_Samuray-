"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const approval = require("./agent-approval");

test("approval is bound to execution context", () => {
  const a = approval.createApproval({
    jobId:"job-1",
    resource:"github://example/repo/actions/runs/1",
    headSha:"abc1234",
    policyVersion:"nexus-policy-v3",
    evidenceHeadHash:"evidence-head"
  });
  assert.ok(a.approvalHash);
  assert.equal(approval.reassess(a, {
    headSha:"abc1234",
    policyVersion:"nexus-policy-v3",
    evidenceHeadHash:"evidence-head"
  }).valid, true);
});

test("approval invalidates on context drift", () => {
  const a = approval.createApproval({
    jobId:"job-2",
    resource:"github://example/repo/actions/runs/2",
    headSha:"abc1234",
    policyVersion:"nexus-policy-v3",
    evidenceHeadHash:"evidence-head"
  });
  const result = approval.reassess(a, {
    headSha:"def5678",
    policyVersion:"nexus-policy-v4",
    evidenceHeadHash:"new-head"
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ["head_sha_changed","policy_version_changed","evidence_context_changed"]);
});
