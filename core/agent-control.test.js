"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createSandboxReceipt} = require("./interop/patch-sandbox");

const REPOSITORY = "smokblack999-a11y/Brand_Samuray-";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

const ac = require("./agent-control");


function installGithubProofFixture(t, {repository, baseSha, headSha, sandboxRunId, ciRunId, patch}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-control-proof-"));
  const evidenceDir = path.join(dir, "evidence");
  fs.mkdirSync(evidenceDir);
  const argsPath = path.join(dir, "gh-args.txt");

  const sandboxRun = JSON.stringify({
    status: "completed",
    conclusion: "success",
    headSha,
    workflowName: "SAMURAI NEXUS Isolated Patch Sandbox",
    event: "pull_request"
  });
  const ciRun = JSON.stringify({
    status: "completed",
    conclusion: "success",
    headSha,
    workflowName: "SamuraiOS Core CI",
    event: "pull_request"
  });
  const cli = path.join(dir, "mock-gh.js");
  const script = `"use strict";
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_TEST_ARGS_FILE, args.join("\\n") + "\\n");
let output;
if (args[0] === "attestation") output = '[{"verificationResult":{"verified":true}}]';
else if (args[0] === "run" && args[2] === process.env.GH_SANDBOX_RUN_ID) output = process.env.GH_SANDBOX_RUN_JSON;
else if (args[0] === "run" && args[2] === process.env.GH_CI_RUN_ID) output = process.env.GH_CI_RUN_JSON;
else process.exit(64);
process.stdout.write(output + "\\n");
`;
  fs.writeFileSync(cli, script, "utf8");

  const previous = {
    args: process.env.GH_TEST_ARGS_FILE,
    evidenceDir: process.env.NEXUS_EVIDENCE_DIR,
    exec: process.env.NEXUS_GH_TEST_EXEC,
    nodeEnv: process.env.NODE_ENV,
    sandboxRunId: process.env.GH_SANDBOX_RUN_ID,
    ciRunId: process.env.GH_CI_RUN_ID,
    sandboxRunJson: process.env.GH_SANDBOX_RUN_JSON,
    ciRunJson: process.env.GH_CI_RUN_JSON
  };
  process.env.GH_TEST_ARGS_FILE = argsPath;
  process.env.NEXUS_EVIDENCE_DIR = evidenceDir;
  process.env.NEXUS_GH_TEST_EXEC = cli;
  process.env.NODE_ENV = "test";
  process.env.GH_SANDBOX_RUN_ID = String(sandboxRunId);
  process.env.GH_CI_RUN_ID = String(ciRunId);
  process.env.GH_SANDBOX_RUN_JSON = sandboxRun;
  process.env.GH_CI_RUN_JSON = ciRun;

  const patchPath = path.join(evidenceDir, "candidate.patch");
  const receiptPath = path.join(evidenceDir, "receipt.json");
  fs.writeFileSync(patchPath, patch);
  const receipt = createSandboxReceipt({
    repository,
    baseSha,
    headSha,
    patch: Buffer.from(patch),
    testLog: "Core sandbox tests passed",
    runId: String(sandboxRunId),
    conclusion: "success"
  });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

  t.after(() => {
    const keys = [
      ["GH_TEST_ARGS_FILE", previous.args],
      ["NEXUS_EVIDENCE_DIR", previous.evidenceDir],
      ["NEXUS_GH_TEST_EXEC", previous.exec],
      ["NODE_ENV", previous.nodeEnv],
      ["GH_SANDBOX_RUN_ID", previous.sandboxRunId],
      ["GH_CI_RUN_ID", previous.ciRunId],
      ["GH_SANDBOX_RUN_JSON", previous.sandboxRunJson],
      ["GH_CI_RUN_JSON", previous.ciRunJson]
    ];
    for (const [key, value] of keys) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, {recursive: true, force: true});
  });

  return {patchPath, receiptPath, argsPath};
}

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
      head_sha: HEAD_SHA,
      base: { sha: BASE_SHA },
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
    repository: confirmed.workflow.repository,
    baseSha: confirmed.workflow.baseSha,
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
    changedFiles: ["core/agent-control.js"],
    diff: "--- a/core/agent-control.js\n+++ b/core/agent-control.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;",
    actor: "x19-e2e-test"
  });
  assert.equal(repair.job.state, "SANDBOX_REQUIRED");

  await assert.rejects(
    orchestrator.recordSandbox(repair.job, {passed: true, runId: 991003}),
    /sandbox_proof_required/
  );
  assert.equal(repair.job.state, "SANDBOX_REQUIRED");
  assert.equal(repair.job.evidence.critic.decision, "ALLOW");
});


test("X19 runtime job persists orchestrator state through proof receipt", async t => {
  const payload = {
    workflow_run: {
      id: 992001,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_branch: "x10think-agent-control-mvp",
      head_sha: HEAD_SHA,
      base: { sha: BASE_SHA },
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

  const patch = "--- a/core/agent-control.js\n+++ b/core/agent-control.js\n@@ -1,1 +1,2 @@\n const existing = true;\n+const repaired = true;";
  const evidence = installGithubProofFixture(t, {
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    sandboxRunId: 992003,
    ciRunId: 992004,
    patch
  });

  const sandboxed = await ac.recordSandbox(proposed, evidence);
  assert.equal(sandboxed.orchestrator.state, "CI_REQUIRED");
  assert.equal(sandboxed.orchestrator.evidence.sandbox.verified, true);

  const ci = await ac.recordCI(sandboxed, {runId: "992004"});
  assert.equal(ci.orchestrator.state, "PROOF_READY");
  assert.equal(ci.orchestrator.evidence.ci.verified, true);

  const proof = ac.finalizeProof(ci, {afterSha: HEAD_SHA});
  assert.equal(proof.job.orchestrator.state, "READY_FOR_REVIEW");
  assert.ok(proof.receipt.proofHash);
  assert.equal(ac.getJob(ingested.job.id).orchestrator.state, "READY_FOR_REVIEW");
  assert.equal(ac.getJob(ingested.job.id).execution.autonomousWrite, false);
  assert.equal(ac.getJob(ingested.job.id).execution.autonomousMerge, false);
  const ghArgs = fs.readFileSync(evidence.argsPath, "utf8");
  assert.ok(ghArgs.startsWith("attestation\nverify\n"));
  assert.ok(ghArgs.includes("\nrun\nview\n992003\n"));
  assert.ok(ghArgs.includes("\nrun\nview\n992004\n"));
});
