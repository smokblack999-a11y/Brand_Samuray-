"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildReproductionPlan } = require("./reproduction-gate");
const { runReproduction } = require("./reproduction-runner");

test("reproduction runner proves baseline failure and patched pass with the same command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-repro-"));
  try {
    await fs.writeFile(path.join(workspace, "check.js"), "process.exit(1);\n", "utf8");
    const plan = buildReproductionPlan({
      evidenceOnly: true,
      workflowRunId: 99,
      category: "generic",
      command: ["node", "check.js"]
    });
    const patch = [
      "--- a/check.js",
      "+++ b/check.js",
      "@@ -1 +1 @@",
      "-process.exit(1);",
      "+process.exit(0);",
      ""
    ].join("\n");

    const proof = await runReproduction({ workspace, plan, patch });
    assert.equal(proof.reproduction, true);
    assert.equal(proof.causality, true);
    assert.equal(proof.passed, true);
    assert.deepEqual(proof.baseline.command, ["node", "check.js"]);
    assert.deepEqual(proof.patched.command, ["node", "check.js"]);
    assert.equal(proof.gates.sameCommand, true);
    assert.equal(proof.baseline.isolated, true);
    assert.equal(proof.patched.isolated, true);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("reproduction runner refuses a missing patch", async () => {
  await assert.rejects(
    () => runReproduction({ workspace: "/tmp", plan: { version: 2, command: ["node", "check.js"] } }),
    /patch is required/
  );
});
