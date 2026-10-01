"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const gate = require("./nexus-recovery-gate");

test("recovery result contains a bounded X29 execution contract", () => {
  const result = gate.evaluateRecovery({
    resource: "github://repo/pull/57",
    workflow: { id: 1001, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: {
      diff: [
        "--- a/src/app.js",
        "+++ b/src/app.js",
        "@@",
        "+safeOperation();"
      ].join("\n")
    },
    changedFiles: ["src/app.js"],
    retryCount: 0,
    actor: "x10think"
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(gate.canExecute(result), true);
  assert.equal(result.executionContract.executor, "x29-github-transport");
  assert.deepEqual(result.executionContract.writeScope, ["src/app.js"]);
  assert.equal(result.executionContract.autonomousMerge, false);
  assert.equal(result.executionContract.autoDeploy, false);
});

test("critical recovery still exposes mandatory post-execution controls", () => {
  const result = gate.evaluateRecovery({
    resource: "github://repo/pull/58",
    workflow: { id: 1002, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: {
      diff: [
        "--- a/src/crypto/key.js",
        "+++ b/src/crypto/key.js",
        "@@",
        "+rotateKey();"
      ].join("\n")
    },
    changedFiles: ["src/crypto/key.js"],
    retryCount: 0
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.executionContract.requiredAfterExecutionChecks, [
    "sandbox", "ci", "proof_receipt"
  ]);
});

test("verification contract fails closed until every required check is observed", () => {
  const result = gate.evaluateRecovery({
    resource: "github://repo/pull/59",
    workflow: { id: 1003, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: {
      diff: [
        "--- a/src/app.js",
        "+++ b/src/app.js",
        "@@",
        "+safeOperation();"
      ].join("\n")
    },
    changedFiles: ["src/app.js"],
    retryCount: 0
  });

  const partial = gate.buildVerificationContract(result, { sandbox: true });
  assert.equal(partial.readyForProof, false);
  assert.deepEqual(partial.missing, ["ci", "proof_receipt"]);

  const complete = gate.buildVerificationContract(result, {
    sandbox: true,
    ci: true,
    proof_receipt: true
  });
  assert.equal(complete.readyForProof, true);
  assert.deepEqual(complete.missing, []);
});

test("retry limit remains fail-closed", () => {
  const result = gate.evaluateRecovery({
    resource: "github://repo/pull/60",
    workflow: { id: 1004, conclusion: "failure" },
    diagnosis: { reproduction: true, causality: true },
    proposal: {
      diff: "+safeOperation();"
    },
    changedFiles: ["src/app.js"],
    retryCount: gate.MAX_RETRIES
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "retry_limit_exceeded");
});
