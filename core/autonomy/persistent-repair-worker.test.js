const assert = require("node:assert/strict");
const { STATES, createJob, transition, recover, shouldRetry } = require("./persistent-repair-worker");

let job = createJob({ id: "job-27", repo: "demo/repo", sha: "abc" });
job = transition(job, STATES.DIAGNOSING);
job = transition(job, STATES.DIAGNOSED, { category: "dependency_error" });
job = transition(job, STATES.PATCHING);
job = transition(job, STATES.TESTING, { command: "npm test" });
assert.equal(job.attempts, 1);
assert.equal(shouldRetry(job), true);

const restored = recover(JSON.parse(JSON.stringify(job)));
assert.equal(restored.state, STATES.TESTING);
assert.equal(restored.history.length, 5);

job = transition(job, STATES.STOPPED, { reason: "test_failed" });
assert.throws(() => transition(job, STATES.TESTING), /terminal/);

let second = createJob({ id: "job-limit" });
second = transition(second, STATES.DIAGNOSING);
second = transition(second, STATES.DIAGNOSED);
second = transition(second, STATES.PATCHING);
second = transition(second, STATES.TESTING);
second = transition(second, STATES.PR_OPEN);
second = transition(second, STATES.TESTING);
assert.equal(second.attempts, 2);
assert.throws(() => transition(second, STATES.TESTING), /invalid transition|terminal|maxAttempts/);

console.log("X27 persistent-repair-worker tests: PASS");
