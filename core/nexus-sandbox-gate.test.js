"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSandboxGate } = require("./nexus-sandbox-gate");

test("Kill Critic failure prevents sandbox execution", async () => {
  let called = false;
  const gate = createSandboxGate({
    runner: async () => {
      called = true;
      return { passed: true };
    }
  });

  const result = await gate({
    workspace: "/tmp",
    commands: [["node", "-e", "process.exit(0)"]],
    killDecision: "KILL",
    proposal: { status: "PATCH_CANDIDATE" }
  });

  assert.equal(called, false);
  assert.equal(result.status, "KILLED");
});

test("bounded passing candidate reaches SANDBOX_PASS", async () => {
  const gate = createSandboxGate({
    runner: async () => ({
      passed: true,
      commands: [{ code: 0, passed: true }]
    })
  });

  const result = await gate({
    workspace: "/tmp",
    commands: [["node", "-e", "process.exit(0)"]],
    killDecision: "PASS",
    proposal: { status: "PATCH_CANDIDATE" }
  });

  assert.equal(result.status, "SANDBOX_PASS");
  assert.equal(result.decision, "PASS");
});

test("sandbox failure blocks promotion", async () => {
  const gate = createSandboxGate({
    runner: async () => ({
      passed: false,
      commands: [{ code: 1, passed: false }]
    })
  });

  const result = await gate({
    workspace: "/tmp",
    commands: [["node", "-e", "process.exit(1)"]],
    killDecision: "PASS",
    proposal: { status: "PATCH_CANDIDATE" }
  });

  assert.equal(result.status, "HUMAN_REVIEW");
  assert.equal(result.decision, "BLOCK");
});