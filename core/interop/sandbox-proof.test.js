"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validateSandboxReceipt,
  verifySandboxAttestation,
  verifyCiRun,
  sha256
} = require("./sandbox-proof");
const {createSandboxReceipt} = require("./patch-sandbox");

const REPOSITORY = "smokblack999-a11y/Brand_Samuray-";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PATCH = "diff --git a/core/server.js b/core/server.js\n--- a/core/server.js\n+++ b/core/server.js\n@@ -1 +1 @@\n-old();\n+new();\n";

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-proof-"));
  const evidenceDir = path.join(dir, "evidence");
  fs.mkdirSync(evidenceDir);
  const argsPath = path.join(dir, "gh-args.txt");
  const cli = path.join(dir, "mock-gh.js");
  const output = JSON.stringify([{"verificationResult":"verified"}]);
  const run = JSON.stringify({
    status: "completed",
    conclusion: options.conclusion || "success",
    headSha: options.headSha || HEAD_SHA,
    workflowName: options.workflowName || "SamuraiOS Core CI",
    event: options.event || "pull_request"
  });
  const sandboxRun = JSON.stringify({
    status: "completed",
    conclusion: options.sandboxConclusion || "success",
    headSha: options.sandboxHeadSha || HEAD_SHA,
    workflowName: options.sandboxWorkflowName || "SAMURAI NEXUS Isolated Patch Sandbox",
    event: options.sandboxEvent || "pull_request"
  });
  const script = `"use strict";
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_TEST_ARGS_FILE, args.join("\\n") + "\\n");
let output;
if (args[0] === "attestation") output = ${JSON.stringify(output)};
else if (args[0] === "run" && args[2] === "44165311952") output = ${JSON.stringify(sandboxRun)};
else if (args[0] === "run") output = ${JSON.stringify(run)};
else process.exit(64);
process.stdout.write(output + "\\n");
`;
  fs.writeFileSync(cli, script, "utf8");
  const oldArgs = process.env.GH_TEST_ARGS_FILE;
  const oldEvidenceDir = process.env.NEXUS_EVIDENCE_DIR;
  const oldExec = process.env.NEXUS_GH_TEST_EXEC;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.GH_TEST_ARGS_FILE = argsPath;
  process.env.NEXUS_EVIDENCE_DIR = evidenceDir;
  process.env.NEXUS_GH_TEST_EXEC = cli;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldArgs === undefined) delete process.env.GH_TEST_ARGS_FILE;
    else process.env.GH_TEST_ARGS_FILE = oldArgs;
    if (oldEvidenceDir === undefined) delete process.env.NEXUS_EVIDENCE_DIR;
    else process.env.NEXUS_EVIDENCE_DIR = oldEvidenceDir;
    if (oldExec === undefined) delete process.env.NEXUS_GH_TEST_EXEC;
    else process.env.NEXUS_GH_TEST_EXEC = oldExec;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    fs.rmSync(dir, {recursive: true, force: true});
  });

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
  return {dir, patchPath, receiptPath, argsPath, receipt};
}

test("validates receipt against repository, both commits and exact patch bytes", () => {
  const receipt = createSandboxReceipt({
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    patch: Buffer.from(PATCH),
    testLog: "tests passed",
    runId: "44165311952",
    conclusion: "success"
  });
  const accepted = validateSandboxReceipt(receipt, {
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA
  }, Buffer.from(PATCH));
  assert.equal(accepted.patchSha256, sha256(Buffer.from(PATCH)));
  assert.equal(accepted.headSha, HEAD_SHA);
  assert.throws(() => validateSandboxReceipt(receipt, {
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: "c".repeat(40)
  }, Buffer.from(PATCH)), /SANDBOX_RECEIPT_SUBJECT_MISMATCH/);
  assert.throws(() => validateSandboxReceipt(receipt, {
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA
  }, Buffer.from(PATCH + "// tampered")), /SANDBOX_PATCH_DIGEST_MISMATCH/);
});

test("verifies sandbox receipt with fixed repository, workflow, source and predicate constraints", async t => {
  const f = fixture(t);
  const proof = await verifySandboxAttestation({
    receiptPath: f.receiptPath,
    patchPath: f.patchPath,
    expected: {repository: REPOSITORY, baseSha: BASE_SHA, headSha: HEAD_SHA}
  });
  assert.equal(proof.verified, true);
  assert.equal(proof.verifier, "gh-attestation-verify");
  assert.equal(proof.patchSha256, f.receipt.patchSha256);
  const args = fs.readFileSync(f.argsPath, "utf8");
  assert.match(args, /--repo\nsmokblack999-a11y\/Brand_Samuray-/);
  assert.match(args, /--signer-workflow\ngithub\.com\/smokblack999-a11y\/Brand_Samuray-\/\.github\/workflows\/nexus-sandbox\.yml/);
  assert.match(args, new RegExp("--source-digest\\n" + HEAD_SHA));
  assert.match(args, /https:\/\/slsa\.dev\/provenance\/v1/);
});

test("rejects missing or tampered receipt data before attestation verification", async t => {
  const f = fixture(t);
  fs.writeFileSync(f.patchPath, PATCH + "// tampered");
  await assert.rejects(verifySandboxAttestation({
    receiptPath: f.receiptPath,
    patchPath: f.patchPath,
    expected: {repository: REPOSITORY, baseSha: BASE_SHA, headSha: HEAD_SHA}
  }), /SANDBOX_PATCH_DIGEST_MISMATCH/);
});

test("verifies CI by run id, repository, completed status, workflow and exact head", async t => {
  const f = fixture(t);
  const result = await verifyCiRun({runId: 1234, repository: REPOSITORY, headSha: HEAD_SHA});
  assert.equal(result.verified, true);
  assert.equal(result.conclusion, "success");
  assert.equal(result.headSha, HEAD_SHA);
  const args = fs.readFileSync(f.argsPath, "utf8");
  assert.match(args, /^run\nview\n1234/m);
  assert.match(args, /--json\nstatus,conclusion,headSha,workflowName,event/);
});

test("rejects CI run for another candidate or workflow", async t => {
  fixture(t, {headSha: "c".repeat(40)});
  await assert.rejects(verifyCiRun({runId: 1234, repository: REPOSITORY, headSha: HEAD_SHA}), /CI_RUN_HEAD_MISMATCH/);
});

test("rejects a non-Core workflow and non-PR event as CI proof", async t => {
  fixture(t, {workflowName: "Untrusted workflow", event: "workflow_dispatch"});
  await assert.rejects(verifyCiRun({runId: 1234, repository: REPOSITORY, headSha: HEAD_SHA}), /CI_RUN_IDENTITY_MISMATCH/);
});
