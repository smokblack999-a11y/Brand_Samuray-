"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPatchProposal } = require("./nexus-patch-proposal");
const { inspectPatch } = require("./nexus-kill-critic");

test("bounded dependency diagnosis creates patch candidate", () => {
  const proposal = createPatchProposal({
    diagnosis: { category: "dependency_error", confidence: 0.96, fingerprint: "abc", summary: "dependency failed" },
    changedPaths: ["core/package.json"]
  });
  assert.equal(proposal.status, "PATCH_CANDIDATE");
});

test("generic diagnosis is escalated", () => {
  const proposal = createPatchProposal({
    diagnosis: { category: "generic", confidence: 0.55 },
    changedPaths: ["core/server.js"]
  });
  assert.equal(proposal.status, "HUMAN_REVIEW");
});

test("Kill Critic kills workflow mutation", () => {
  const proposal = createPatchProposal({
    diagnosis: { category: "dependency_error", confidence: 0.96 },
    changedPaths: ["core/package.json"]
  });
  const result = inspectPatch({
    proposal,
    changedPaths: [".github/workflows/core.yml"],
    diffText: "+ permissions: write"
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("forbidden_paths"));
});

test("Kill Critic kills secret-like material", () => {
  const proposal = createPatchProposal({
    diagnosis: { category: "syntax_error", confidence: 0.99 },
    changedPaths: ["core/a.js"]
  });
  const result = inspectPatch({
    proposal,
    changedPaths: ["core/a.js"],
    diffText: "+ token=ghp_123456789012345678901234567890"
  });
  assert.equal(result.decision, "KILL");
});

test("Kill Critic passes bounded minimal diff", () => {
  const proposal = createPatchProposal({
    diagnosis: { category: "test_failure", confidence: 0.98 },
    changedPaths: ["core/a.test.js"]
  });
  const result = inspectPatch({
    proposal,
    changedPaths: ["core/a.test.js"],
    diffText: "+ assert.equal(actual, expected);"
  });
  assert.equal(result.decision, "PASS");
});
