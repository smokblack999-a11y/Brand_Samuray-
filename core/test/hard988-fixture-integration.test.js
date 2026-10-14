"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const hard988 = require("../hard988-repair-evidence-gate");
const { appendReceipt, verifyLedger } = require("../hard988-receipt-ledger");

const SECRET = "hard988-fixture-only-secret-not-for-production";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "HARD988 fixture",
      GIT_AUTHOR_EMAIL: "hard988-fixture@example.invalid",
      GIT_COMMITTER_NAME: "HARD988 fixture",
      GIT_COMMITTER_EMAIL: "hard988-fixture@example.invalid"
    }
  });
  assert.equal(result.error, undefined, result.error && result.error.message);
  return {
    exitCode: result.status === null ? 1 : result.status,
    output: String(result.stdout || "") + String(result.stderr || "")
  };
}

function git(cwd, args) {
  const result = run("git", args, cwd);
  assert.equal(result.exitCode, 0, "git " + args.join(" ") + " failed: " + result.output);
  return result.output.trim();
}

function check(name, command, args, cwd, binding) {
  const startedAt = new Date().toISOString();
  const result = run(command, args, cwd);
  const finishedAt = new Date().toISOString();
  return hard988.signEvidence({
    checkId: name + "-" + crypto.randomUUID(),
    name,
    status: result.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: result.exitCode,
    runnerId: "hard988-disposable-fixture-test",
    startedAt,
    finishedAt,
    artifactSha256: crypto.createHash("sha256").update(result.output).digest("hex")
  }, SECRET, binding);
}

test("disposable Git fixture binds real commits, sandbox syntax check and passing CI test", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hard988-fixture-repo-"));
  try {
    await fs.mkdir(path.join(dir, "src"));
    await fs.mkdir(path.join(dir, "test"));
    git(dir, ["init", "-q"]);
    await fs.writeFile(path.join(dir, "src/fix.js"), "module.exports = (a, b) => a - b;\n");
    await fs.writeFile(path.join(dir, "test/fix.test.js"),
      '"use strict";\nconst test = require("node:test");\nconst assert = require("node:assert/strict");\nconst add = require("../src/fix");\ntest("fixed addition", () => assert.equal(add(2, 3), 5));\n');
    git(dir, ["add", "src/fix.js", "test/fix.test.js"]);
    git(dir, ["commit", "-q", "-m", "fixture baseline"]);
    const beforeSha = git(dir, ["rev-parse", "HEAD"]);

    await fs.writeFile(path.join(dir, "src/fix.js"), "module.exports = (a, b) => a + b;\n");
    git(dir, ["add", "src/fix.js"]);
    git(dir, ["commit", "-q", "-m", "repair addition"]);
    const afterSha = git(dir, ["rev-parse", "HEAD"]);
    const diff = git(dir, ["diff", beforeSha, afterSha, "--", "src/fix.js"]);
    const input = {
      resource: "fixture://hard988/disposable-git-repo",
      fromState: "CI_PASSED",
      toState: "READY_FOR_REVIEW",
      beforeSha,
      afterSha,
      files: ["src/fix.js"],
      diff
    };
    const binding = hard988.createCandidateBinding(input);
    input.checks = [
      check("sandbox", process.execPath, ["--check", "src/fix.js"], dir, binding),
      check("ci", process.execPath, ["--test", "test/fix.test.js"], dir, binding)
    ];

    const result = hard988.evaluateHard988(input, { secret: SECRET });
    assert.equal(result.decision, "READY_FOR_HUMAN_REVIEW", JSON.stringify(result.reasons));
    assert.equal(result.mergeAllowed, false);
    assert.equal(result.manualReviewRequired, true);
    assert.equal(result.beforeSha, beforeSha);
    assert.equal(result.afterSha, afterSha);
    assert.equal(result.evidence.length, 2);

    const ledgerPath = path.join(dir, "hard988-receipts.jsonl");
    await appendReceipt(ledgerPath, result);
    const ledgerState = await verifyLedger(ledgerPath);
    assert.equal(ledgerState.valid, true);
    assert.equal(ledgerState.entries, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
