"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractCandidatePaths, extractDiff, generatePatchCandidate, redactSensitive } = require("../recovery-proposer");

test("extracts bounded source paths from failure logs", () => {
  const paths = extractCandidatePaths("at core/server.js:10\ncore/recovery-worker.js:4 package.json");
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

test("redacts common credentials before model submission", () => {
  const input = [
    "Authorization: Bearer ghp_exampleSecret123",
    "OPENAI_API_KEY=sk-1234567890abcdef",
    "api_key=super-secret-value",
    "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----"
  ].join("\\n");
  const output = redactSensitive(input);
  assert.doesNotMatch(output, /ghp_exampleSecret123/);
  assert.doesNotMatch(output, /sk-1234567890abcdef/);
  assert.doesNotMatch(output, /super-secret-value/);
  assert.doesNotMatch(output, /-----BEGIN PRIVATE KEY-----/);
  assert.match(output, /REDACTED/);
});
