"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { planMission, recordVerification } = require("./architect-repair-adapter");

test("X29 plan produces explicit proof requirements", () => {
  const plan = planMission(
    { id: "job-1", input: { failure: {
      failure_signature: "test_failure",
      failing_step: "npm test",
      log: "Assertion failed",
      reproducible: true
    }}},
    { strategy: "diagnose-patch-verify", candidate: {
      rationale: "fix assertion",
      changed_files: ["src/a.js"],
      changed_lines: 4,
      test_commands: ["npm test"]
    }}
  );
  assert.equal(plan.missionId, "job-1");
  assert.equal(plan.diagnosis.category, "test_failure");
  assert.equal(plan.requiredEvidence.length, 4);
});

test("X29 verification delegates proof to X28", () => {
  const job = Object.freeze({
    id: "job-2",
    state: "patching",
    attempts: 0,
    maxAttempts: 2,
    history: [{ state: "queued", attempt: 0 }]
  });
  const result = recordVerification({
    job,
    repair: { changedFiles: ["src/a.js"], changedLines: 4, commands: ["npm test"] },
    critic: { decision: "PASS", reasons: [] }
  }, { passed: true, command: "npm test", exitCode: 0 });
  assert.equal(result.proof.status, "PROVEN");
  assert.equal(result.job.state, "proven");
  assert.equal(result.job.attempts, 1);
});
