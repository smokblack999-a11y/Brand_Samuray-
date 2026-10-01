"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateRecovery, canExecute, buildWorkflowResource } = require("../nexus-recovery");

const valid = {
  resource: "github://owner/repo/pull/10",
  workflow: { id: 123, conclusion: "failure" },
  retryCount: 0,
  diagnosis: { reproduction: true, causality: true },
  changedFiles: ["src/service.js"],
  proposal: {
    source: "x10think",
    diff: [
      "--- a/src/service.js",
      "+++ b/src/service.js",
      "@@ -1 +1 @@",
      "-old()",
      "+new()"
    ].join("\n")
  }
};

test("observed CI failure can enter controlled repair proposal", () => {
  const result = evaluateRecovery(valid);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.state, "REPAIR_PROPOSED");
  assert.equal(canExecute(result), true);
  assert.ok(result.recoveryId);
});

test("success cannot trigger recovery", () => {
  const result = evaluateRecovery({
    ...valid,
    workflow: { id: 123, conclusion: "success" }
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "recovery_requires_observed_ci_failure");
});

test("retry limit is fail-closed", () => {
  const result = evaluateRecovery({ ...valid, retryCount: 3 });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "retry_limit_exceeded");
});

test("diagnosis must establish reproduction and causality", () => {
  const result = evaluateRecovery({
    ...valid,
    diagnosis: { reproduction: true, causality: false }
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "reproduction_and_causality_required");
});

test("invalid patch is rejected before policy execution", () => {
  const result = evaluateRecovery({
    ...valid,
    proposal: { diff: "not a unified diff" }
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "PATCH_HUNK_REQUIRED");
});

test("critical patch stays blocked until its policy gate evidence exists", () => {
  const result = evaluateRecovery({
    ...valid,
    changedFiles: ["src/crypto/key.js"],
    proposal: {
      diff: [
        "--- a/src/crypto/key.js",
        "+++ b/src/crypto/key.js",
        "@@ -1 +1 @@",
        "-old()",
        "+new()"
      ].join("\n")
    }
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.criticality, "HIGH");
  assert.ok(result.requiredChecks.includes("sandbox"));
});

test("resource identity is deterministic for workflow runs", () => {
  assert.equal(
    buildWorkflowResource({
      id: 42,
      repository: { full_name: "owner/repo" }
    }),
    "github://owner/repo/actions/runs/42"
  );
});
