"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ac = require("./agent-control");

test("classifies failed test workflow as evidence-gated CI failure", () => {
  const result = ac.classifyFailure({ name: "SamuraiOS Core CI", conclusion: "failure" });
  assert.equal(result.category, "ci_failure");
  assert.equal(result.evidenceRequired, true);
});

test("does not classify success as failure", () => {
  const result = ac.classifyFailure({ name: "Build", conclusion: "success" });
  assert.equal(result.category, "none");
});

test("verifies GitHub HMAC SHA-256 signatures", () => {
  const crypto = require("node:crypto");
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "test-secret";
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(ac.verifyGithubSignature(body, signature, secret), true);
  assert.equal(ac.verifyGithubSignature(body, signature, "wrong"), false);
});

test("requires reproduction and causality before repair eligibility", () => {
  const job = {
    id: "test-job",
    state: "EVIDENCE_PENDING",
    classification: { category: "ci_failure" }
  };
  const first = ac.diagnose(job, { logs: "AssertionError: expected 1", reproduction: true, causality: false });
  assert.equal(first.state, "EVIDENCE_PENDING");

  const second = ac.diagnose(job, { logs: "AssertionError: expected 1", reproduction: true, causality: true });
  assert.equal(second.state, "REPAIR_ELIGIBLE");
});

test("GitHub evidence collection never grants repair eligibility without reproduction and causality", async () => {
  const fakeClient = {
    async collectFailureEvidence(repository, runId) {
      return {
        repository,
        runId,
        jobs: [{ id: 42, name: "SamuraiOS Core CI", conclusion: "failure" }],
        failedLogs: [{ jobId: 42, name: "SamuraiOS Core CI", conclusion: "failure", content: "AssertionError: expected 1" }]
      };
    }
  };
  const job = {
    id: "github-evidence-test",
    state: "EVIDENCE_PENDING",
    workflow: { id: 123, repository: "smokblack999-a11y/Brand_Samuray-" },
    classification: { category: "ci_failure" },
    diagnosis: { status: "pending", reproduction: false, causality: false }
  };
  const updated = await ac.collectGithubEvidence(job, fakeClient);
  assert.equal(updated.diagnosis.source, "github-actions");
  assert.equal(updated.diagnosis.reproduction, false);
  assert.equal(updated.diagnosis.causality, false);
  assert.equal(updated.state, "EVIDENCE_PENDING");
});


test("X19 E2E fail-closed path reaches proof only after evidence, sandbox and CI", async () => {
  const recovery = require("./nexus-recovery");
  const orchestrator = require("./nexus-repair-orchestrator");

  const workflowPayload = {
    workflow_run: {
      id: 991001,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_branch: "x10think-agent-control-mvp",
      head_sha: "before-sha",
      base: { sha: "base-sha" },
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
      actor: { login: "x10think" },
      html_url: "https://github.com/smokblack999-a11y/Brand_Samuray-/actions/runs/991001"
    }
  };

  const ingested = ac.ingestWorkflowRun(workflowPayload, "x19-e2e-test-" + Date.now());
  assert.equal(ingested.job.state, "EVIDENCE_PENDING");

  const evidenceClient = {
    async collectFailureEvidence(repository, runId) {
      return {
        repository,
        runId,
        jobs: [{ id: 991002, name: "Core tests", conclusion: "failure" }],
        failedLogs: [{
          jobId: 991002,
          name: "Core tests",
          conclusion: "failure",
          content: "AssertionError: expected repairable result"
        }]
      };
    }
  };

  const observed = await ac.collectGithubEvidence(ingested.job, evidenceClient);
  assert.equal(observed.state, "EVIDENCE_PENDING");
  assert.equal(observed.diagnosis.source, "github-actions");
  assert.equal(observed.diagnosis.reproduction, false);
  assert.equal(observed.diagnosis.causality, false);

  const confirmed = ac.diagnose(observed, {
    logs: "AssertionError: expected repairable result",
    reproduction: true,
    causality: true,
    source: "sandbox-reproduction"
  });
  assert.equal(confirmed.state, "REPAIR_ELIGIBLE");

  const recoveryBlocked = recovery.evaluateRecovery({
    workflow: {
      id: confirmed.workflow.id,
      conclusion: confirmed.workflow.conclusion,
      repository: confirmed.workflow.repository
    },
    resource: confirmed.resource,
    diagnosis: confirmed.diagnosis,
    retryCount: 0,
    proposal: {
      changedFiles: ["core/nexus-resource-policy.js"],
      diff: "--- a/core/agent-control.js\n+++ b/core/agent-control.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;",
      source: "x19-e2e-test"
    }
  });
  assert.equal(recoveryBlocked.decision, "BLOCK");
  assert.equal(recoveryBlocked.reason, "policy_gate_evidence_required");

  const recoveryAllowed = recovery.evaluateRecovery({
    workflow: {
      id: confirmed.workflow.id,
      conclusion: confirmed.workflow.conclusion,
      repository: confirmed.workflow.repository
    },
    resource: confirmed.resource,
    diagnosis: confirmed.diagnosis,
    retryCount: 0,
    policyGateEvidence: { checks: ["sandbox", "ci", "proof_receipt"] },
    proposal: {
      changedFiles: ["core/agent-control.js"],
      diff: "--- a/core/agent-control.js\n+++ b/core/agent-control.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;",
      source: "x19-e2e-test"
    }
  });
  assert.equal(recoveryAllowed.decision, "ALLOW");
  assert.equal(recoveryAllowed.candidateAccepted, true);

  const job = orchestrator.createJob({
    resource: confirmed.resource,
    workflowRunId: confirmed.workflow.id,
    changedFiles: ["core/agent-control.js"],
    headSha: confirmed.workflow.headSha,
    conclusion: "failure"
  });

  const repair = orchestrator.evaluateRepair(job, {
    changedFiles: ["core/agent-control.js"],
    diff: "--- a/core/agent-control.js\n+++ b/core/agent-control.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;",
    actor: "x19-e2e-test"
  });
  assert.equal(repair.job.state, "SANDBOX_REQUIRED");

  const sandboxed = orchestrator.recordSandbox(repair.job, {
    passed: true,
    runId: 991003
  });
  assert.equal(sandboxed.state, "CI_REQUIRED");

  const ci = orchestrator.recordCI(sandboxed, {
    conclusion: "success",
    runId: 991004
  });
  assert.equal(ci.state, "PROOF_READY");

  const proof = orchestrator.finalizeProof(ci, {
    afterSha: "after-sha",
    validations: ["evidence", "reproduction", "causality"]
  });

  assert.equal(proof.job.state, "READY_FOR_REVIEW");
  assert.equal(proof.receipt.transition.to, "READY_FOR_REVIEW");
  assert.ok(proof.receipt.proofHash);
  assert.deepEqual(
    proof.receipt.checks,
    ["critic", "sandbox", "ci", "evidence", "reproduction", "causality"]
  );
});
