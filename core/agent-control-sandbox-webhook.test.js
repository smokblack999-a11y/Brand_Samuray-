"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const path = require("node:path");
const ac = require("./agent-control");
const {createSandboxReceipt} = require("./interop/patch-sandbox");

const REPOSITORY = "smokblack999-a11y/Brand_Samuray-";
function makeContext() {
  return {
    baseSha: crypto.randomBytes(20).toString("hex"),
    headSha: crypto.randomBytes(20).toString("hex")
  };
}
const SANDBOX_RUN_ID = "991003";
const PATCH =
  "--- a/core/agent-control.js\n" +
  "+++ b/core/agent-control.js\n" +
  "@@ -1,1 +1,2 @@\n" +
  " const existing = true;\n" +
  "+const repaired = true;\n";
const TEST_LOG = Buffer.from("Sandbox: 117 tests passed\n");

function installArtifactMock(t, context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-webhook-ingest-"));
  const evidenceDir = path.join(root, "durable-evidence");
  const argsPath = path.join(root, "gh-args.txt");
  const cliPath = path.join(root, "mock-gh.js");
  const receipt = createSandboxReceipt({
    repository: REPOSITORY,
    baseSha: context.baseSha,
    headSha: context.headSha,
    patch: Buffer.from(PATCH),
    testLog: TEST_LOG,
    runId: SANDBOX_RUN_ID,
    conclusion: "success"
  });
  const runInfo = {
    status: "completed",
    conclusion: "success",
    headSha: context.headSha,
    workflowName: "SAMURAI NEXUS Isolated Patch Sandbox",
    event: "pull_request"
  };

  const script = [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(process.env.NEXUS_GH_TEST_ARGS, args.join("\\n") + "\\n");',
    'if (args[0] === "attestation") {',
    '  process.stdout.write("[{\\"verificationResult\\":{\\"verified\\":true}}]\\n");',
    '} else if (args[0] === "run" && args[1] === "view") {',
    '  process.stdout.write(' + JSON.stringify(JSON.stringify(runInfo)) + ' + "\\n");',
    '} else if (args[0] === "run" && args[1] === "download") {',
    '  const index = args.indexOf("--dir");',
    '  if (index < 0) process.exit(64);',
    '  const dir = args[index + 1];',
    '  fs.mkdirSync(path.join(dir, "nexus-evidence"), {recursive: true});',
    '  fs.writeFileSync(path.join(dir, "candidate.patch"), ' + JSON.stringify(PATCH) + ');',
    '  fs.writeFileSync(path.join(dir, "nexus-test.log"), Buffer.from(' + JSON.stringify(TEST_LOG.toString("base64")) + ', "base64"));',
    '  fs.writeFileSync(path.join(dir, "nexus-evidence", "receipt.json"), ' + JSON.stringify(JSON.stringify(receipt, null, 2) + "\n") + ');',
    '  process.stdout.write("downloaded\\n");',
    '} else { process.exit(64); }'
  ].join("\n") + "\n";
  fs.writeFileSync(cliPath, script, "utf8");

  const previous = {
    nodeEnv: process.env.NODE_ENV,
    exec: process.env.NEXUS_GH_TEST_EXEC,
    args: process.env.NEXUS_GH_TEST_ARGS,
    evidenceRoot: process.env.NEXUS_EVIDENCE_DIR
  };
  process.env.NODE_ENV = "test";
  process.env.NEXUS_GH_TEST_EXEC = cliPath;
  process.env.NEXUS_GH_TEST_ARGS = argsPath;
  process.env.NEXUS_EVIDENCE_DIR = evidenceDir;

  t.after(() => {
    for (const [key, value] of [
      ["NODE_ENV", previous.nodeEnv],
      ["NEXUS_GH_TEST_EXEC", previous.exec],
      ["NEXUS_GH_TEST_ARGS", previous.args],
      ["NEXUS_EVIDENCE_DIR", previous.evidenceRoot]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, {recursive: true, force: true});
  });

  return {root, evidenceDir, argsPath};
}

function failedCoreWorkflow(deliveryId, context) {
  return ac.ingestWorkflowRun({
    workflow_run: {
      id: Number(deliveryId.replace(/\D/g, "").slice(-8)) || 99100001,
      name: "SamuraiOS Core CI",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_branch: "nexus-evidence-ingest-test",
      head_sha: context.headSha,
      repository: {full_name: REPOSITORY},
      pull_requests: [{
        number: 151,
        base: {sha: context.baseSha, repo: {full_name: REPOSITORY}},
        head: {sha: context.headSha, ref: "nexus-evidence-ingest-test"}
      }]
    }
  }, deliveryId);
}

function sandboxWebhook(context) {
  return {
    action: "completed",
    repository: {full_name: REPOSITORY},
    workflow_run: {
      id: Number(SANDBOX_RUN_ID),
      name: "SAMURAI NEXUS Isolated Patch Sandbox",
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      head_sha: context.headSha,
      repository: {full_name: REPOSITORY},
      pull_requests: [{
        number: 151,
        base: {sha: context.baseSha, repo: {full_name: REPOSITORY}},
        head: {sha: context.headSha, ref: "nexus-evidence-ingest-test"}
      }]
    }
  };
}

test("signed sandbox workflow event downloads, verifies and attaches artifact to matching pending job", async t => {
  const context = makeContext();
  const mock = installArtifactMock(t, context);
  const ingested = failedCoreWorkflow("nexus-evidence-ingest-core-" + Date.now(), context);
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: sandbox evidence test",
    reproduction: true,
    causality: true,
    source: "webhook-integration-test"
  });
  const proposed = ac.proposeRepair(diagnosed, {
    changedFiles: ["core/agent-control.js"],
    diff: PATCH,
    actor: "nexus-evidence-test"
  });
  assert.equal(proposed.orchestrator.state, "SANDBOX_REQUIRED");

  const result = await ac.ingestSandboxWorkflowRun(sandboxWebhook(context));
  assert.equal(result.ignored, false);
  assert.equal(result.runId, SANDBOX_RUN_ID);
  assert.equal(result.job.orchestrator.state, "CI_REQUIRED");
  assert.equal(result.job.orchestrator.evidence.sandbox.verified, true);
  assert.equal(fs.existsSync(path.join(mock.evidenceDir, "run-" + SANDBOX_RUN_ID, "receipt.json")), true);
  assert.equal(fs.existsSync(path.join(mock.evidenceDir, "run-" + SANDBOX_RUN_ID, "candidate.patch")), true);

  const persisted = ac.getJob(ingested.job.id);
  assert.equal(persisted.orchestrator.state, "CI_REQUIRED");
  assert.equal(persisted.orchestrator.evidence.sandbox.verified, true);

  const args = fs.readFileSync(mock.argsPath, "utf8");
  assert.match(args, /run\nview\n991003/);
  assert.match(args, /run\ndownload\n991003/);
  assert.match(args, /attestation\nverify/);
});

test("duplicate sandbox workflow delivery does not download or advance a job twice", async t => {
  const context = makeContext();
  const mock = installArtifactMock(t, context);
  const ingested = failedCoreWorkflow("nexus-evidence-duplicate-" + Date.now(), context);
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: duplicate webhook",
    reproduction: true,
    causality: true,
    source: "webhook-integration-test"
  });
  ac.proposeRepair(diagnosed, {
    changedFiles: ["core/agent-control.js"],
    diff: PATCH,
    actor: "nexus-evidence-test"
  });

  const first = await ac.ingestSandboxWorkflowRun(sandboxWebhook(context));
  assert.equal(first.ignored, false);
  const argsBefore = fs.readFileSync(mock.argsPath, "utf8");
  const second = await ac.ingestSandboxWorkflowRun(sandboxWebhook(context));
  const argsAfter = fs.readFileSync(mock.argsPath, "utf8");

  assert.equal(second.ignored, true);
  assert.equal(second.reason, "no_matching_sandbox_required_job");
  assert.equal(argsAfter, argsBefore);
});

test("ignores unsuccessful sandbox completion without granting CI_REQUIRED", async () => {
  const context = makeContext();
  const ingested = failedCoreWorkflow("nexus-evidence-failure-" + Date.now(), context);
  const diagnosed = ac.diagnose(ingested.job, {
    logs: "AssertionError: failure path",
    reproduction: true,
    causality: true,
    source: "webhook-integration-test"
  });
  const proposed = ac.proposeRepair(diagnosed, {
    changedFiles: ["core/agent-control.js"],
    diff: PATCH,
    actor: "nexus-evidence-test"
  });
  const payload = sandboxWebhook(context);
  payload.workflow_run.conclusion = "failure";
  const result = await ac.ingestSandboxWorkflowRun(payload);

  assert.equal(result.ignored, true);
  assert.equal(result.reason, "sandbox_run_not_successful");
  assert.equal(ac.getJob(ingested.job.id).orchestrator.state, "SANDBOX_REQUIRED");
  assert.equal(proposed.orchestrator.state, "SANDBOX_REQUIRED");
});
