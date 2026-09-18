"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { inspectPatch } = require("./nexus-kill-critic");

function proposal(overrides = {}) {
  return {
    status: "PATCH_CANDIDATE",
    scope: { maxFiles: 3 },
    ...overrides
  };
}

test("passes a bounded normal diff", () => {
  const result = inspectPatch({
    proposal: proposal(),
    changedPaths: ["core/a.js"],
    diffText: "@@\n+const fixed = true;\n"
  });
  assert.equal(result.decision, "PASS");
  assert.equal(result.failures.length, 0);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
});

test("kills workflow mutation", () => {
  const result = inspectPatch({
    proposal: proposal(),
    changedPaths: [".github/workflows/deploy.yml"],
    diffText: "@@\n+run: deploy\n"
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("forbidden_paths"));
  assert.ok(result.failures.includes("workflow_mutation"));
});

test("kills secret-like material", () => {
  const result = inspectPatch({
    proposal: proposal(),
    changedPaths: ["core/config.js"],
    diffText: "@@\n+token = ghp_12345678901234567890\n"
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("secret_like_material"));
});

test("kills excessive file scope", () => {
  const result = inspectPatch({
    proposal: proposal(),
    changedPaths: ["a.js", "b.js", "c.js", "d.js"],
    diffText: "@@\n+small change\n"
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("scope_too_large_or_empty"));
});

test("kills oversized additions", () => {
  const diff = Array.from({ length: 121 }, (_, i) => `+line-${i}`).join("\n");
  const result = inspectPatch({
    proposal: proposal(),
    changedPaths: ["core/a.js"],
    diffText: diff
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("too_many_added_lines"));
});

test("kills missing diff", () => {
  const result = inspectPatch({
    proposal: proposal(),
    changedPaths: ["core/a.js"],
    diffText: ""
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("missing_diff"));
});

test("kills human-review proposals", () => {
  const result = inspectPatch({
    proposal: proposal({ status: "HUMAN_REVIEW" }),
    changedPaths: ["core/a.js"],
    diffText: "@@\n+change\n"
  });
  assert.equal(result.decision, "KILL");
  assert.ok(result.failures.includes("proposal_not_bounded"));
});