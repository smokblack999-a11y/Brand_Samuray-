"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateRecovery, canExecute, MAX_RETRIES } = require("../nexus-recovery-gate");

const base = {
  resource: "github://repo/workflow/build",
  workflow: { id: 123, conclusion: "failure" },
  diagnosis: { reproduction: true, causality: true },
  changedFiles: ["src/service.js"],
  proposal: { diff: "--- a/src/service.js\n+++ b/src/service.js\n@@ -1 +1 @@\n+safeFix();" }
};

test("observed failure can enter bounded repair", () => {
  const r = evaluateRecovery(base);
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.state, "REPAIR_PROPOSED");
  assert.equal(canExecute(r), true);
  assert.match(r.recoveryId, /^[a-f0-9]{64}$/);
});

test("success cannot start recovery", () => {
  const r = evaluateRecovery({ ...base, workflow: { conclusion: "success" } });
  assert.equal(r.decision, "BLOCK");
});

test("missing causality blocks", () => {
  const r = evaluateRecovery({ ...base, diagnosis: { reproduction: true, causality: false } });
  assert.equal(r.decision, "BLOCK");
});

test("retry limit is hard", () => {
  const r = evaluateRecovery({ ...base, retryCount: MAX_RETRIES });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.reason, "retry_limit_exceeded");
});

test("dangerous candidate is blocked by policy", () => {
  const r = evaluateRecovery({ ...base, proposal: { diff: "--- a/src/service.js\n+++ b/src/service.js\n@@ -1 +1 @@\n+rm -rf /" } });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.dangerousFindings.includes("recursive_delete"));
});

test("critical workflow change exposes required controls", () => {
  const r = evaluateRecovery({
    ...base,
    changedFiles: [".github/workflows/build.yml"],
    proposal: { diff: "--- a/.github/workflows/build.yml\n+++ b/.github/workflows/build.yml\n@@ -1 +1 @@\n+safeStep: true" }
  });
  assert.equal(r.decision, "ALLOW");
  assert.ok(r.requiredChecks.includes("sandbox"));
  assert.ok(r.requiredChecks.includes("ci"));
  assert.ok(r.requiredChecks.includes("proof_receipt"));
});

test("resource identity is mandatory", () => {
  const r = evaluateRecovery({ ...base, resource: "" });
  assert.equal(r.decision, "BLOCK");
});
