"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runRecovery } = require("./nexus-recovery-orchestrator");

function proposal() {
  return {
    diff: "--- a/src/app.js\n+++ b/src/app.js\n+safeOperation();",
    files: ["src/app.js"]
  };
}

test("orchestrator refuses execution without X29 executor", async () => {
  const result = await runRecovery({
    resource: "github://repo/pull/100",
    workflow: { id: 100, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: proposal(),
    changedFiles: ["src/app.js"],
    retryCount: 0
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "x29_executor_missing");
});

test("orchestrator runs bounded repair, verification and proof", async () => {
  let persisted = null;

  const executor = {
    async applyPatch() {
      return { applied: true, beforeSha: "before", afterSha: "after" };
    },
    async verify() {
      return {
        sandbox: true,
        tests_passed: true,
        ci: true,
        invariants_passed: true,
        proof_receipt: true,
        runId: "verify-1"
      };
    },
    async persistProof(proof) {
      persisted = proof;
    }
  };

  const result = await runRecovery({
    resource: "github://repo/pull/101",
    workflow: { id: 101, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: proposal(),
    changedFiles: ["src/app.js"],
    retryCount: 0,
    executor
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.state, "READY_FOR_REVIEW");
  assert.ok(result.proof);
  assert.equal(result.proof.beforeSha, "before");
  assert.equal(result.proof.afterSha, "after");
  assert.equal(persisted.proofHash, result.proof.proofHash);
});

test("orchestrator never produces proof after incomplete verification", async () => {
  const result = await runRecovery({
    resource: "github://repo/pull/102",
    workflow: { id: 102, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: proposal(),
    changedFiles: ["src/app.js"],
    retryCount: 0,
    executor: {
      async applyPatch() {
        return { applied: true, beforeSha: "before", afterSha: "after" };
      },
      async verify() {
        return { sandbox: true };
      }
    }
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "verification_incomplete");
});
