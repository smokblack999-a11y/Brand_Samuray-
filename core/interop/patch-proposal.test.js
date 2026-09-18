"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPatchProposal } = require("./patch-proposal");

const good = [
  "--- a/test.js",
  "+++ b/test.js",
  "@@ -1 +1 @@",
  "-fail",
  "+pass",
  ""
].join("\n");

test("accepts a bounded validated proposal before verification", () => {
  const result = buildPatchProposal({
    evidenceOnly: true,
    diff: good,
    changedFiles: ["test.js"],
    source: "agent"
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.proposal.files, ["test.js"]);
  assert.equal(result.proposal.autonomousWrite, false);
  assert.equal(result.proposal.autonomousMerge, false);
});

test("rejects a proposal before proof", () => {
  const result = buildPatchProposal({ evidenceOnly: true, reproduction: false, causality: false, diff: good });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "REPRODUCTION_AND_CAUSALITY_REQUIRED");
});

test("rejects unrelated files", () => {
  const result = buildPatchProposal({
    evidenceOnly: true,
    reproduction: true,
    causality: true,
    diff: good,
    changedFiles: ["src/app.js"]
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "PATCH_TOUCHES_UNRELATED_FILE");
});
