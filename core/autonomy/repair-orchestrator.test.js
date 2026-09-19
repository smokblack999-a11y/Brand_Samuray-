const assert = require("node:assert/strict");
const {
  start,
  diagnoseJob,
  applyArchitectPlan,
  evaluateRepair,
  recordTest,
  openPr,
  verifyPr
} = require("./repair-orchestrator");
const { STATES } = require("./persistent-repair-worker");

const event = {
  workflow_run: {
    id: 123,
    repository: { full_name: "acme/repo" },
    head_sha: "abc123",
    head_branch: "main",
    name: "CI",
    conclusion: "failure"
  }
};

const started = start(event);
assert.equal(started.job.state, STATES.QUEUED);

const diagnosed = diagnoseJob(started.job);
assert.equal(diagnosed.state, STATES.DIAGNOSED);

const architectPlanned = require("./repair-orchestrator").applyArchitectPlan(diagnosed, {
  status: "planned",
  plan: { actions: ["diagnose", "patch"], tests: ["npm test"], constraints: ["no secrets"] }
});
assert.equal(architectPlanned.architect.status, "planned");
assert.deepEqual(architectPlanned.architect.plan.tests, ["npm test"]);
assert.equal(architectPlanned.state, STATES.DIAGNOSED);

const planned = applyArchitectPlan(diagnosed, {
  status: "planned",
  plan: {
    actions: ["diagnose", "patch"],
    tests: ["npm test"],
    constraints: ["no workflow changes"]
  }
});
assert.deepEqual(planned.architect.plan.actions, ["diagnose", "patch"]);
assert.deepEqual(planned.architect.plan.tests, ["npm test"]);

const accepted = evaluateRepair(planned, {
  rationale: "Fix the failing dependency import.",
  changed_files: ["src/app.js"],
  changed_lines: 4,
  test_commands: ["npm test"]
});
assert.equal(accepted.critic.decision, "PASS");
assert.equal(accepted.job.state, STATES.PATCHING);
assert.deepEqual(accepted.job.architect.plan.constraints, ["no workflow changes"]);

const proven = recordTest(accepted.job, accepted.repair, accepted.critic, {
  passed: true,
  command: "npm test",
  exitCode: 0
});
assert.equal(proven.proof.status, "PROVEN");
assert.equal(proven.job.state, STATES.PROVEN);

const pr = openPr(proven.job, { number: 42 });
assert.equal(pr.state, STATES.PR_OPEN);

const verified = verifyPr(pr, { passed: true });
assert.equal(verified.state, STATES.VERIFIED);

const rejected = evaluateRepair(diagnosed, {
  rationale: "Touch workflow.",
  changed_files: [".github/workflows/ci.yml"],
  changed_lines: 2,
  test_commands: ["npm test"]
});
assert.equal(rejected.critic.decision, "REJECT");
assert.equal(rejected.job.state, STATES.REJECTED);

console.log("X29 Architect -> X28 orchestrator tests: PASS");
