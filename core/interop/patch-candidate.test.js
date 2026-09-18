"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUnifiedDiff } = require("./patch-candidate");
const { buildPatchProposal } = require("./patch-proposal");

const DIFF = [
  "diff --git a/src/a.js b/src/a.js",
  "index 1111111..2222222 100644",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  ""
].join("\n");

test("validates a normal unified diff", () => {
  const result = validateUnifiedDiff(DIFF);
  assert.deepEqual(result.files, ["src/a.js"]);
});

test("rejects path traversal", () => {
  assert.throws(() => validateUnifiedDiff(
    DIFF.replace("src/a.js", "../escape.js")
  ), /PATCH_UNSAFE_PATH/);
});

test("patch proposal exposes Kill Critic decision and never enables autonomous merge", () => {
  const result = buildPatchProposal({
    evidenceOnly: true,
    reproduction: true,
    causality: true,
    diff: DIFF,
    changedFiles: ["src/a.js"],
    changedLines: 2,
    risk: "low",
    sandboxPassed: true,
    ciPassed: true,
    evidence: {
      exactErrorMatch: 1,
      stackTraceMatch: 1,
      changedFileMatch: 1,
      dependencyMatch: 1,
      historicalMatch: 1,
      reproducible: 1
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.critic.action, "OPEN_PR");
  assert.equal(result.proposal.autonomousPr, true);
  assert.equal(result.proposal.autonomousMerge, false);
});
