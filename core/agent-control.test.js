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
    changedFiles: ["src/crypto/key.js"],
    proposal: {
      changedFiles: ["core/agent-control.test.js"],
      diff: "--- a/src/crypto/key.js\n+++ b/src/crypto/key.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;",
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
    changedFiles: ["core/agent-control.js"],
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

  const diagnosedJob = orchestrator.nextState(job, "DIAGNOSING", {
    evidence: "github-actions",
    reproduction: true,
    causality: true
  });
  const proposedJob = orchestrator.nextState(diagnosedJob, "REPAIR_PROPOSED", {
    proposal: "validated"
  });
  const repair = orchestrator.evaluateRepair(proposedJob, {
    intent: "fix failing CI in agent control",
    intent: "fix failing CI in agent control",
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


test("repair proposal blocks semantic scope expansion before sandbox", async () => {
  const payload = {
    workflow_run: {
      id: 993001,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_sha: "before-sha",
      base: { sha: "base-sha" },
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  };
  const ingested = ac.ingestWorkflowRun(payload, "semantic-gate-" + Date.now());
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: semantic gate",
    reproduction: true,
    causality: true,
    source: "sandbox-reproduction"
  });
  const blocked = ac.proposeRepair(diagnosed, {
    intent: "fix authentication test",
    changedFiles: ["tests/auth.test.js", "src/auth/token.js", "src/permissions/rbac.js"],
    diff: "+export const repaired = true;",
    actor: "semantic-test"
  });
  assert.equal(blocked.orchestrator.state, "CRITIC_BLOCKED");
  assert.equal(blocked.intentGate.reason, "action_scope_exceeds_intent");
  const persisted = ac.getJob(ingested.job.id);
  assert.equal(persisted.orchestrator.state, "CRITIC_BLOCKED");
});

test("repair proposal fails closed when declared intent is missing", async () => {
  const payload = {
    workflow_run: {
      id: 993002,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_sha: "before-sha",
      base: { sha: "base-sha" },
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  };
  const ingested = ac.ingestWorkflowRun(payload, "missing-intent-" + Date.now());
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: missing intent",
    reproduction: true,
    causality: true,
    source: "sandbox-reproduction"
  });
  const blocked = ac.proposeRepair(diagnosed, {
    changedFiles: ["core/agent-control.js"],
    diff: "+const repaired = true;",
    actor: "missing-intent-test"
  });
  assert.equal(blocked.orchestrator.state, "CRITIC_BLOCKED");
  assert.equal(blocked.intentGate.reason, "declared_intent_unrecognized");
});

test("reproduction gate proves causality only from failed baseline plus same-SHA sandbox pass", async () => {
  const payload = {
    workflow_run: {
      id: 994001,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_sha: "same-sha",
      base: { sha: "base-sha" },
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  };
  const ingested = ac.ingestWorkflowRun(payload, "repro-gate-" + Date.now());
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: candidate",
    reproduction: false,
    causality: false,
    source: "github-actions"
  });

  const updated = await ac.reproduceRepair(diagnosed, {
    intent: "fix failing CI in agent control",
    changedFiles: ["core/agent-control.js"],
    diff: "--- a/core/agent-control.js\\n+++ b/core/agent-control.js\\n@@ -1,1 +1,2 @@\\n const existing = true;\\n+const repaired = true;",
    workspacePath: "/workspaces/samurai",
    testCommand: "npm test"
  }, {
    async reproduceRepair(input) {
      assert.equal(input.commitSha, "same-sha");
      assert.equal(input.repository, "smokblack999-a11y/Brand_Samuray-");
      return {
        runId: "sandbox-994002",
        status: "PASSED",
        passed: true,
        exitCode: 0,
        timeout: false,
        patchSha256: "patch-hash",
        environmentHash: "env-hash",
        networkAccess: false,
        commitSha: "same-sha"
      };
    }
  });

  assert.equal(updated.state, "REPAIR_ELIGIBLE");
  assert.equal(updated.diagnosis.reproduction, true);
  assert.equal(updated.diagnosis.causality, true);
  assert.equal(updated.diagnosis.source, "github-baseline-plus-sandbox-candidate");
  assert.equal(evidence.verify(updated.evidenceChain), true);
});

test("reproduction gate refuses causal claim when sandbox candidate fails", async () => {
  const payload = {
    workflow_run: {
      id: 994003,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_sha: "same-sha-fail",
      base: { sha: "base-sha" },
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  };
  const ingested = ac.ingestWorkflowRun(payload, "repro-gate-fail-" + Date.now());
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: candidate",
    reproduction: false,
    causality: false,
    source: "github-actions"
  });
  const updated = await ac.reproduceRepair(diagnosed, {
    intent: "fix failing CI in agent control",
    changedFiles: ["core/agent-control.js"],
    diff: "--- a/core/agent-control.js\\n+++ b/core/agent-control.js\\n@@ -1,1 +1,2 @@\\n const existing = true;\\n+const repaired = true;",
    workspacePath: "/workspaces/samurai"
  }, {
    async reproduceRepair() {
      return {
        runId: "sandbox-994004",
        status: "FAILED",
        passed: false,
        exitCode: 1,
        timeout: false,
        patchSha256: "patch-hash",
        environmentHash: "env-hash",
        networkAccess: false,
        commitSha: "same-sha-fail"
      };
    }
  });
  assert.equal(updated.state, "EVIDENCE_PENDING");
  assert.equal(updated.diagnosis.causality, false);
  assert.equal(evidence.verify(updated.evidenceChain), true);
});

test("X19 runtime job persists orchestrator state through proof receipt", async () => {
  const payload = {
    workflow_run: {
      id: 992001,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_branch: "x10think-agent-control-mvp",
      head_sha: "runtime-before",
      base: { sha: "base-sha" },
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
      actor: { login: "x10think" },
      html_url: "https://github.com/smokblack999-a11y/Brand_Samuray-/actions/runs/992001"
    }
  };

  const ingested = ac.ingestWorkflowRun(payload, "x19-runtime-" + Date.now());
  const observed = await ac.collectGithubEvidence(ingested.job, {
    async collectFailureEvidence(repository, runId) {
      return {
        repository,
        runId,
        jobs: [{ id: 992002, name: "Core tests", conclusion: "failure" }],
        failedLogs: [{ jobId: 992002, name: "Core tests", conclusion: "failure", content: "AssertionError: runtime proof" }]
      };
    }
  });

  const diagnosed = ac.diagnose(observed, {
    logs: "AssertionError: runtime proof",
    reproduction: true,
    causality: true,
    source: "sandbox-reproduction"
  });
  assert.equal(diagnosed.orchestrator.state, "DIAGNOSING");

  const proposed = ac.proposeRepair(diagnosed, {
    changedFiles: ["core/agent-control.js"],
    diff: "--- a/core/agent-control.js\n+++ b/core/agent-control.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;",
    actor: "x19-runtime-test"
  });
  assert.equal(proposed.orchestrator.state, "SANDBOX_REQUIRED");

  const sandboxed = ac.recordSandbox(proposed, { passed: true, runId: 992003 });
  assert.equal(sandboxed.orchestrator.state, "CI_REQUIRED");

  const ci = ac.recordCI(sandboxed, { conclusion: "success", runId: 992004 });
  assert.equal(ci.orchestrator.state, "PROOF_READY");

  const proof = ac.finalizeProof(ci, {
    afterSha: "runtime-after",
    validations: ["evidence", "reproduction", "causality"]
  });
  assert.equal(proof.job.orchestrator.state, "READY_FOR_REVIEW");
  assert.ok(proof.receipt.proofHash);
  assert.equal(ac.getJob(ingested.job.id).orchestrator.state, "READY_FOR_REVIEW");
  assert.equal(ac.getJob(ingested.job.id).execution.autonomousWrite, false);
  assert.equal(ac.getJob(ingested.job.id).execution.autonomousMerge, false);
});
