const assert = require("node:assert/strict");
const {
  diagnose,
  proposeRepair,
  killCritic,
  buildProofReceipt
} = require("./proof-repair-engine");

const failure = {
  failure_signature: "MODULE_NOT_FOUND: foo",
  failing_step: "npm test",
  log: "Cannot find module foo",
  reproducible: true
};

const diagnosis = diagnose(failure);
assert.equal(diagnosis.category, "dependency_error");

const repair = proposeRepair({
  diagnosis,
  candidate: {
    rationale: "Restore the missing dependency import.",
    changed_files: ["src/app.js"],
    changed_lines: 4,
    test_commands: ["npm test"]
  }
});

const critic = killCritic({ failure, diagnosis, repair });
assert.equal(critic.decision, "PASS");
assert.deepEqual(critic.reasons, []);

const proof = buildProofReceipt({
  jobId: "job-test-001",
  failure,
  diagnosis,
  repair,
  critic,
  testResult: { passed: true, command: "npm test", exitCode: 0 }
});

assert.equal(proof.status, "PROVEN");
assert.equal(proof.evidence.kill_critic, "PASS");

const unsafe = killCritic({
  failure,
  diagnosis,
  repair: proposeRepair({
    diagnosis,
    candidate: {
      rationale: "Unsafe change",
      changed_files: [".github/workflows/ci.yml"],
      changed_lines: 2,
      test_commands: ["npm test"]
    }
  })
});

assert.equal(unsafe.decision, "REJECT");
assert.match(unsafe.reasons[0], /blocked_paths/);

console.log("X25 proof-repair-engine tests: PASS");
