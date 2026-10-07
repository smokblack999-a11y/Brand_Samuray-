"use strict";

const assert = require("node:assert/strict");
const control = require("./agent-control");
const sandbox = require("./agent-sandbox-client");

(async () => {
  const workspace = process.env.WORKSPACE;
  const sandboxUrl = process.env.X10THINK_SANDBOX_URL;
  if (!workspace || !sandboxUrl) throw new Error("E2E_WORKSPACE_OR_SANDBOX_URL_MISSING");

  const workflow = {
    workflow_run: {
      id: Number(process.env.E2E_WORKFLOW_RUN_ID || 910000001),
      name: "X10THINK Real Sandbox E2E",
      event: "workflow_dispatch",
      conclusion: "failure",
      head_sha: process.env.GITHUB_SHA,
      head_branch: process.env.GITHUB_HEAD_REF || "e2e",
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  };

  const ingested = control.ingestWorkflowRun(workflow, "e2e-sandbox-delivery-" + (process.env.GITHUB_RUN_ID || Date.now()));
  assert.equal(ingested.duplicate, false);

  const patch = [
    "diff --git a/core/e2e-fixture.js b/core/e2e-fixture.js",
    "--- a/core/e2e-fixture.js",
    "+++ b/core/e2e-fixture.js",
    "@@ -1,3 +1,3 @@",
    ' "use strict";',
    "",
    "-module.exports = 1;",
    "+module.exports = 2;"
  ].join("\n") + "\n";

  process.env.X10THINK_SANDBOX_URL = sandboxUrl;
  const result = await control.reproduceRepair(ingested.job, {
    intent: "repair test failure",
    changedFiles: ["core/e2e-fixture.js"],
    diff: patch,
    workspacePath: workspace,
    testCommand: "node -e 'if (require(\"./core/e2e-fixture\") !== 2) process.exit(1)'"
  }, sandbox);

  console.log("E2E_RESULT", JSON.stringify(result, null, 2));
  assert.equal(result.state, "REPAIR_ELIGIBLE");
  assert.equal(result.diagnosis.reproduction, true);
  assert.equal(result.diagnosis.causality, true);
  assert.equal(result.execution.autonomousWrite, false);
  assert.equal(result.execution.autonomousMerge, false);
  assert.equal(result.evidenceChain.headHash.length, 64);
  assert.equal(result.diagnosis.reproductionEvidence.candidate.passed, true);
  assert.equal(result.diagnosis.reproductionEvidence.candidate.networkAccess, false);

  console.log(JSON.stringify({
    ok: true,
    state: result.state,
    causality: result.diagnosis.causality,
    evidenceHeadHash: result.evidenceChain.headHash,
    patchSha256: result.diagnosis.reproductionEvidence.candidate.patchSha256
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
