"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GATES, evaluateRealLifeGates, canTransitionToRecovered } = require("./real-life-gates");

test("defines exactly 15 real-life gates", () => {
  assert.equal(GATES.length, 15);
});

test("secret exposure produces KILL", () => {
  const r = evaluateRealLifeGates({ diff: "x", secretExposure: true });
  assert.equal(r.decision, "KILL");
  assert.ok(r.failed.some(g => g.id === "G04"));
});

test("sandbox failure prevents recovery", () => {
  const r = evaluateRealLifeGates({
    diff: "x",
    sandboxPassed: false,
    testsPassed: true,
    adversarialPassed: true,
    ciPassed: true,
    evidenceComplete: true
  });
  assert.equal(r.decision, "REJECT");
  assert.equal(canTransitionToRecovered({
    patchApplied: true,
    sandboxPassed: false,
    testsPassed: true,
    adversarialPassed: true,
    ciPassed: true,
    evidenceComplete: true
  }), false);
});

test("clean verified recovery can transition", () => {
  const ctx = {
    diff: "safe change",
    changedLines: 20,
    criticalPathChanged: false,
    secretExposure: false,
    privilegeEscalation: false,
    cryptoInvariantBroken: false,
    workflowPrivilegeIncrease: false,
    unreviewedDependencyChange: false,
    sandboxPassed: true,
    testsPassed: true,
    adversarialPassed: true,
    behaviorDrift: false,
    ciPassed: true,
    evidenceComplete: true,
    patchApplied: true
  };
  assert.equal(canTransitionToRecovered(ctx), true);
});
