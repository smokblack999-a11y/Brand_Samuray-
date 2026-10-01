"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const control = require("./x10/control-plane");

test("X10 allows only declared state transitions", () => {
  assert.equal(control.canTransition("DETECTED", "PROPOSING_PATCH"), true);
  assert.equal(control.canTransition("DETECTED", "RESOLVED"), false);
  assert.equal(control.canTransition("RESOLVED", "DETECTED"), false);
});

test("HIGH risk requires human merge", () => {
  const p = control.policyFor({ risk: "HIGH", repository: "main" });
  assert.equal(p.autonomous_execution, true);
  assert.equal(p.production_mutation, false);
  assert.equal(p.merge, "HUMAN_REQUIRED");
});

test("Kill switch blocks autonomous transition", () => {
  const result = control.evaluateTransition({
    incident: {
      incident_id: "inc_test",
      state: "POLICY_CHECKING"
    },
    toState: "SANDBOX_PENDING",
    actor: "PolicyEngine",
    reason: "test",
    killSwitch: true
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.state, "HUMAN_APPROVAL_REQUIRED");
});

test("Invalid commit SHA is rejected", () => {
  assert.throws(() => control.validateIncident({
    incident_id: "inc_test",
    event_id: "evt_test",
    repository: "repo",
    commit_sha: "not-a-sha",
    failure_fingerprint: "fp",
    risk: "HIGH"
  }), /invalid_commit_sha/);
});
