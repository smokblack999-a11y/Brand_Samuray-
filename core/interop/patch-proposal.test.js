"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPatchProposal } = require("./patch-proposal");

const diff = [
  "diff --git a/src/a.js b/src/a.js",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1 +1 @@",
  "-old",
  "+new"
].join("\n");

test("blocks a patch unless evidence is complete", () => {
  assert.equal(buildPatchProposal({ diff }).accepted, false);
  assert.equal(buildPatchProposal({ diff, evidenceOnly: true, reproduction: true, causality: false }).reason, "REPRODUCTION_AND_CAUSALITY_REQUIRED");
});

test("accepts a safe evidence-backed patch through the security gate", () => {
  const result = buildPatchProposal({
    diff,
    evidenceOnly: true,
    reproduction: true,
    causality: true,
    repository: "smokblack999-a11y/Brand_Samuray-",
    jobId: "job-1",
    commitSha: "abc123",
    failureClass: "test-failure"
  });
  assert.equal(result.accepted, true);
  assert.equal(result.security.gate, "PASS");
  assert.equal(result.proposal.autonomousWrite, false);
  assert.equal(result.proposal.autonomousMerge, false);
});

test("blocks a credential-bearing patch before sandbox", () => {
  const secretDiff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1 +1 @@",
    "-old",
    "+const apiKey = \"sk-proj-abcdefghijklmnopqrstuvwxyz1234567890\";"
  ].join("\n");
  const result = buildPatchProposal({
    diff: secretDiff,
    evidenceOnly: true,
    reproduction: true,
    causality: true
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "SECURITY_GATE_BLOCKED");
});
