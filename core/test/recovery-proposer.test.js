"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractCandidatePaths, extractDiff, generatePatchCandidate } = require("../recovery-proposer");

test("extracts bounded source paths from failure logs", () => {
  const paths = extractCandidatePaths("at core/server.js:10
core/recovery-worker.js:4 package.json");
  assert.deepEqual(paths, ["core/server.js", "core/recovery-worker.js", "package.json"]);
});

test("extractDiff rejects prose without a unified diff", () => {
  assert.equal(extractDiff("NO_PATCH"), "");
});

test("AI proposer is fail-closed when disabled", async () => {
  const previous = process.env.RECOVERY_AI_PROPOSALS;
  delete process.env.RECOVERY_AI_PROPOSALS;
  const result = await generatePatchCandidate({ repoDir: process.cwd(), failureLogs:"x", diagnosis:{}, fingerprint:"abc" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "AI_PROPOSALS_DISABLED");
  if (previous === undefined) delete process.env.RECOVERY_AI_PROPOSALS;
  else process.env.RECOVERY_AI_PROPOSALS = previous;
});
