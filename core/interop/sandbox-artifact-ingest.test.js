"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createSandboxReceipt} = require("./patch-sandbox");
const {ingestSandboxArtifact, sha256} = require("./sandbox-proof");

const REPOSITORY = "smokblack999-a11y/Brand_Samuray-";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PATCH = Buffer.from(
  "diff --git a/core/server.js b/core/server.js\n" +
  "--- a/core/server.js\n" +
  "+++ b/core/server.js\n" +
  "@@ -1 +1 @@\n" +
  "-old();\n" +
  "+new();\n"
);
const TEST_LOG = Buffer.from("NEXUS sandbox test output: 117 passed, 0 failed\n");

function fixture(t, options = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-artifact-test-"));
  const evidenceRoot = path.join(workspace, "durable-evidence");
  const argsPath = path.join(workspace, "gh-args.txt");
  const cliPath = path.join(workspace, "mock-gh.js");

  const runId = String(options.runId || "123456789");
  const runInfo = {
    status: options.status || "completed",
    conclusion: options.conclusion || "success",
    headSha: options.headSha || HEAD_SHA,
    workflowName: options.workflowName || "SAMURAI NEXUS Isolated Patch Sandbox",
    event: options.event || "pull_request"
  };
  const receipt = createSandboxReceipt({
    repository: REPOSITORY,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    patch: PATCH,
    testLog: TEST_LOG,
    runId,
    conclusion: "success"
  });
  const receiptJson = JSON.stringify(receipt, null, 2) + "\n";
  const runList = [{
    databaseId: Number(runId),
    status: runInfo.status,
    conclusion: runInfo.conclusion,
    headSha: options.discoveryHeadSha || HEAD_SHA,
    workflowName: runInfo.workflowName,
    event: runInfo.event,
    createdAt: "2026-11-18T08:00:00Z"
  }];

  const scriptLines = [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(process.env.NEXUS_GH_TEST_ARGS, args.join("\\n") + "\\n");',
    'if (args[0] === "run" && args[1] === "list") {',
    '  const runs = ' + JSON.stringify(runList) + ';',
    '  process.stdout.write(JSON.stringify(runs) + "\\n");',
    '} else if (args[0] === "run" && args[1] === "view") {',
    '  process.stdout.write(' + JSON.stringify(JSON.stringify(runInfo)) + ' + "\\n");',
    '} else if (args[0] === "run" && args[1] === "download") {',
    '  const dirIndex = args.indexOf("--dir");',
    '  if (dirIndex < 0 || !args[dirIndex + 1]) process.exit(64);',
    '  const root = args[dirIndex + 1];',
    '  fs.mkdirSync(path.join(root, "nexus-evidence"), {recursive: true});',
    options.omitPatch ? "" : '  fs.writeFileSync(path.join(root, "candidate.patch"), Buffer.from(' + JSON.stringify(PATCH.toString("base64")) + ', "base64"));',
    options.omitLog ? "" : '  fs.writeFileSync(path.join(root, "nexus-test.log"), Buffer.from(' + JSON.stringify(Buffer.from(options.testLog || TEST_LOG).toString("base64")) + ', "base64"));',
    options.omitReceipt ? "" : '  fs.writeFileSync(path.join(root, "nexus-evidence", "receipt.json"), ' + JSON.stringify(receiptJson) + ');',
    '  process.stdout.write("downloaded\\n");',
    '} else { process.exit(64); }'
  ];
  fs.writeFileSync(cliPath, scriptLines.filter(Boolean).join("\n") + "\n", "utf8");

  const previous = {
    nodeEnv: process.env.NODE_ENV,
    exec: process.env.NEXUS_GH_TEST_EXEC,
    args: process.env.NEXUS_GH_TEST_ARGS,
    evidenceRoot: process.env.NEXUS_EVIDENCE_DIR
  };
  process.env.NODE_ENV = "test";
  process.env.NEXUS_GH_TEST_EXEC = cliPath;
  process.env.NEXUS_GH_TEST_ARGS = argsPath;
  process.env.NEXUS_EVIDENCE_DIR = evidenceRoot;

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
    fs.rmSync(workspace, {recursive: true, force: true});
  });

  return {workspace, evidenceRoot, argsPath, runId};
}

const expected = {
  repository: REPOSITORY,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

test("auto-discovers the exact sandbox run, downloads its artifact and stages only receipt + patch", async t => {
  const f = fixture(t);
  const result = await ingestSandboxArtifact({expected});

  assert.equal(result.runId, f.runId);
  assert.equal(result.artifactName, "nexus-sandbox-evidence-" + f.runId);
  assert.equal(result.patchSha256, sha256(PATCH));
  assert.equal(fs.readFileSync(result.patchPath).equals(PATCH), true);
  assert.equal(fs.existsSync(result.receiptPath), true);
  assert.equal(fs.existsSync(path.join(f.evidenceRoot, "run-" + f.runId, "nexus-test.log")), false);

  const args = fs.readFileSync(f.argsPath, "utf8");
  assert.match(args, /run\nlist/);
  assert.match(args, /--commit\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(args, /run\nview\n123456789/);
  assert.match(args, /run\ndownload\n123456789/);
  assert.match(args, /nexus-sandbox-evidence-123456789/);
});

test("can ingest a specific sandbox run without discovery", async t => {
  const f = fixture(t);
  const result = await ingestSandboxArtifact({runId: f.runId, expected});
  assert.equal(result.runId, f.runId);
  const args = fs.readFileSync(f.argsPath, "utf8");
  assert.doesNotMatch(args, /run\nlist/);
});

test("rejects a run whose completed workflow belongs to another candidate SHA", async t => {
  fixture(t, {headSha: "c".repeat(40)});
  await assert.rejects(
    ingestSandboxArtifact({runId: "123456789", expected}),
    /SANDBOX_RUN_HEAD_MISMATCH/
  );
});

test("rejects artifact test-log bytes that do not match the receipt digest", async t => {
  fixture(t, {testLog: Buffer.from("tampered test output")});
  await assert.rejects(
    ingestSandboxArtifact({runId: "123456789", expected}),
    /SANDBOX_TEST_LOG_DIGEST_MISMATCH/
  );
  assert.equal(fs.existsSync(path.join(process.env.NEXUS_EVIDENCE_DIR, "run-123456789")), false);
});

test("rejects an incomplete artifact rather than persisting partial evidence", async t => {
  fixture(t, {omitReceipt: true});
  await assert.rejects(
    ingestSandboxArtifact({runId: "123456789", expected}),
    /SANDBOX_ARTIFACT_LAYOUT_INVALID/
  );
  assert.equal(fs.existsSync(path.join(process.env.NEXUS_EVIDENCE_DIR, "run-123456789")), false);
});

test("rejects discovery when the latest matching candidate sandbox run did not succeed", async t => {
  fixture(t, {conclusion: "failure"});
  await assert.rejects(
    ingestSandboxArtifact({expected}),
    /SANDBOX_LATEST_RUN_NOT_SUCCESSFUL/
  );
});

test("repeated ingestion of identical run evidence is idempotent", async t => {
  const f = fixture(t);
  const first = await ingestSandboxArtifact({runId: f.runId, expected});
  const second = await ingestSandboxArtifact({runId: f.runId, expected});
  assert.equal(first.receiptPath, second.receiptPath);
  assert.equal(first.patchPath, second.patchPath);
});
