"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const o = require("../nexus-repair-orchestrator");
const {createSandboxReceipt} = require("../interop/patch-sandbox");

const REPOSITORY = "smokblack999-a11y/Brand_Samuray-";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PATCH = "diff --git a/core/server.js b/core/server.js\n--- a/core/server.js\n+++ b/core/server.js\n@@ -1 +1 @@\n-old();\n+new();\n";

function setupGh(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-orchestrator-"));
  const evidenceDir = path.join(dir, "evidence");
  fs.mkdirSync(evidenceDir);
  const argsPath = path.join(dir, "gh-args.txt");
  const cli = path.join(dir, "mock-gh.js");
  const attestationOutput = '[{"verificationResult":"verified"}]';
  const ciOutput = JSON.stringify({
    status: "completed",
    conclusion: options.conclusion || "success",
    headSha: options.headSha || HEAD_SHA,
    workflowName: options.workflowName || "SamuraiOS Core CI",
    event: options.event || "pull_request"
  });
  const sandboxOutput = JSON.stringify({
    status: "completed",
    conclusion: "success",
    headSha: HEAD_SHA,
    workflowName: "SAMURAI NEXUS Isolated Patch Sandbox",
    event: "pull_request"
  });
  const script = `"use strict";
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_TEST_ARGS_FILE, args.join("\\n") + "\\n");
let output;
if (args[0] === "attestation") output = ${JSON.stringify(attestationOutput)};
else if (args[0] === "run" && args[2] === "44165311952") output = ${JSON.stringify(sandboxOutput)};
else if (args[0] === "run") output = ${JSON.stringify(ciOutput)};
else process.exit(64);
process.stdout.write(output + "\\n");
`;
  fs.writeFileSync(cli, script, "utf8");

  const previous = {
    args: process.env.GH_TEST_ARGS_FILE,
    evidenceDir: process.env.NEXUS_EVIDENCE_DIR,
    exec: process.env.NEXUS_GH_TEST_EXEC,
    nodeEnv: process.env.NODE_ENV
  };
  process.env.GH_TEST_ARGS_FILE = argsPath;
  process.env.NEXUS_EVIDENCE_DIR = evidenceDir;
  process.env.NEXUS_GH_TEST_EXEC = cli;
  process.env.NODE_ENV = "test";

  const patchPath = path.join(evidenceDir, "candidate.patch");
  const receiptPath = path.join(evidenceDir, "receipt.json");
  fs.writeFileSync(patchPath, PATCH);
  const receipt = createSandboxReceipt({
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    patch: Buffer.from(PATCH),
    testLog: "105 tests passed",
    runId: "44165311952",
    conclusion: "success"
  });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

  t.after(() => {
    if (previous.args === undefined) delete process.env.GH_TEST_ARGS_FILE;
    else process.env.GH_TEST_ARGS_FILE = previous.args;
    if (previous.evidenceDir === undefined) delete process.env.NEXUS_EVIDENCE_DIR;
    else process.env.NEXUS_EVIDENCE_DIR = previous.evidenceDir;
    if (previous.exec === undefined) delete process.env.NEXUS_GH_TEST_EXEC;
    else process.env.NEXUS_GH_TEST_EXEC = previous.exec;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {dir, evidenceDir, argsPath, patchPath, receiptPath};
}

function createReadyForSandbox(maxAttempts = 3) {
  let job = o.createJob({
    resource: "github://" + REPOSITORY + "/pull/151",
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    changedFiles: ["core/server.js"],
    conclusion: "failure"
  }, {maxAttempts});
  job = o.nextState(job, "DIAGNOSING");
  job = o.evaluateRepair(job, {diff: PATCH}).job;
  return job;
}

test("failure -> Kill Critic -> attested sandbox -> verified CI -> proof -> review", async t => {
  setupGh(t);
  let job = createReadyForSandbox();
  assert.equal(job.state, "SANDBOX_REQUIRED");

  job = await o.recordSandbox(job, {
    receiptPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "receipt.json"),
    patchPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "candidate.patch")
  });
  assert.equal(job.state, "CI_REQUIRED");
  assert.equal(job.evidence.sandbox.verified, true);

  job = await o.recordCI(job, {runId: "44165311953"});
  assert.equal(job.state, "PROOF_READY");
  assert.equal(job.evidence.ci.verified, true);

  const out = o.finalizeProof(job, {afterSha: HEAD_SHA});
  assert.equal(out.job.state, "READY_FOR_REVIEW");
  assert.equal(out.receipt.before.sha, BASE_SHA);
  assert.equal(out.receipt.after.sha, HEAD_SHA);
  assert.match(out.receipt.proofHash, /^[a-f0-9]{64}$/);
});

test("a caller-supplied passed boolean cannot satisfy the sandbox gate", async () => {
  const job = createReadyForSandbox();
  await assert.rejects(o.recordSandbox(job, {passed: true, runId: 10}), /sandbox_proof_required/);
});

test("tampered candidate patch is rejected and cannot reach CI_REQUIRED", async t => {
  setupGh(t);
  const job = createReadyForSandbox();
  fs.writeFileSync(path.join(process.env.NEXUS_EVIDENCE_DIR, "candidate.patch"), PATCH + "// changed");
  const failed = await o.recordSandbox(job, {
    receiptPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "receipt.json"),
    patchPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "candidate.patch")
  });
  assert.equal(failed.state, "SANDBOX_FAILED");
  assert.equal(failed.evidence.sandbox.verified, false);
});

test("dangerous patch is blocked by Kill Critic before sandbox", () => {
  let job = o.createJob({resource: "github://" + REPOSITORY + "/pull/151", changedFiles: ["core/server.js"]});
  job = o.nextState(job, "DIAGNOSING");
  const result = o.evaluateRepair(job, {diff: "+ rm -rf /"});
  assert.equal(result.evaluation.decision, "BLOCK");
  assert.equal(result.job.state, "CRITIC_BLOCKED");
});

test("safe proposal without repository/base/head context is stopped before sandbox", () => {
  let job = o.createJob({resource: "github://" + REPOSITORY + "/pull/151", changedFiles: ["core/server.js"]});
  job = o.nextState(job, "DIAGNOSING");
  const result = o.evaluateRepair(job, {diff: "+ safeFix();"});
  assert.equal(result.job.state, "STOPPED");
  assert.deepEqual(result.evaluation.missingProofContext, ["repository", "base_sha", "head_sha"]);
});

test("CI failure cannot create proof", async t => {
  setupGh(t, {conclusion: "failure"});
  let job = createReadyForSandbox();
  job = await o.recordSandbox(job, {
    receiptPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "receipt.json"),
    patchPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "candidate.patch")
  });
  job = await o.recordCI(job, {runId: "44165311953"});
  assert.equal(job.state, "CI_FAILED");
  assert.throws(() => o.finalizeProof(job), /proof_requires_ci_success/);
});

test("retry budget stops repeated CI failures", async t => {
  setupGh(t, {conclusion: "failure"});
  let job = createReadyForSandbox(1);
  job = await o.recordSandbox(job, {
    receiptPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "receipt.json"),
    patchPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "candidate.patch")
  });
  job = await o.recordCI(job, {runId: "44165311953"});
  assert.equal(job.state, "STOPPED");
});

test("a proof cannot be finalized without matching sandbox, CI and Kill Critic evidence", () => {
  const job = {
    state: "PROOF_READY",
    resource: "github://" + REPOSITORY + "/pull/151",
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    patchSha256: "c".repeat(64),
    changedFiles: ["core/server.js"],
    evidence: {
      critic: {decision: "ALLOW"},
      sandbox: {verified: true, repository: REPOSITORY, baseSha: BASE_SHA, headSha: HEAD_SHA, patchSha256: "d".repeat(64)},
      ci: {verified: true, conclusion: "success", repository: REPOSITORY, headSha: HEAD_SHA}
    }
  };
  assert.throws(() => o.finalizeProof(job), /proof_requires_matching_attested_sandbox/);
});

test("CI proof rejects a run for a different commit", async t => {
  setupGh(t, {headSha: "c".repeat(40)});
  const job = await o.recordSandbox(createReadyForSandbox(), {
    receiptPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "receipt.json"),
    patchPath: path.join(process.env.NEXUS_EVIDENCE_DIR, "candidate.patch")
  });
  await assert.rejects(o.recordCI(job, {runId: "44165311953"}), /CI_RUN_HEAD_MISMATCH/);
});


test("public nextState cannot bypass sandbox, CI or proof verification gates", () => {
  const base = o.createJob({
    resource: "github://" + REPOSITORY + "/pull/151",
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    changedFiles: ["core/server.js"],
    conclusion: "failure"
  });
  const diagnosing = o.nextState(base, "DIAGNOSING");
  assert.throws(() => o.nextState(diagnosing, "SANDBOX_REQUIRED", {
    critic: {decision: "ALLOW"}
  }), /verified_transition_requires_proof/);

  const sandboxed = {...diagnosing, state: "SANDBOX_REQUIRED"};
  assert.throws(() => o.nextState(sandboxed, "CI_REQUIRED", {
    sandbox: {verified: true}
  }), /verified_transition_requires_proof/);

  const ciReady = {...diagnosing, state: "CI_REQUIRED"};
  assert.throws(() => o.nextState(ciReady, "PROOF_READY", {
    ci: {verified: true, conclusion: "success"}
  }), /verified_transition_requires_proof/);

  const proofReady = {...diagnosing, state: "PROOF_READY"};
  assert.throws(() => o.nextState(proofReady, "READY_FOR_REVIEW", {
    proof: {proofHash: "fake"}
  }), /verified_transition_requires_proof/);
});
