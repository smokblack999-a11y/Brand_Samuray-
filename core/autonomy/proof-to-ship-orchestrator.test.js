const assert = require("assert");
const {
  ingest,
  startDiagnosis,
  finishDiagnosis,
  evaluateCandidate,
  beginTesting,
  recordTest,
  buildReceipt,
  openPr,
  verifyPr
} = require("./proof-to-ship-orchestrator");

const event = {
  workflow_run: {
    id: 28001,
    name: "SamuraiOS Core CI",
    conclusion: "failure",
    head_sha: "abc123",
    head_branch: "main",
    repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
  }
};

const ignored = ingest({ workflow_run: { ...event.workflow_run, conclusion: "success" } });
assert.strictEqual(ignored.routed.action, "ignore_success");

let result = ingest(event);
assert.strictEqual(result.routed.action, "enqueue_repair");
let job = result.job;
assert.strictEqual(job.state, "queued");

job = startDiagnosis(job);
const diagnosed = finishDiagnosis(job);
job = diagnosed.job;
assert.strictEqual(job.state, "diagnosed");

const rejected = evaluateCandidate(job, diagnosed.diagnosis, {
  rationale: "unsafe",
  changed_files: [".github/workflows/ci.yml"],
  changed_lines: 1,
  test_commands: ["npm test"]
});
assert.strictEqual(rejected.critic.decision, "REJECT");
assert.strictEqual(rejected.job.state, "rejected");

result = ingest({ workflow_run: { ...event.workflow_run, id: 28002 } });
job = finishDiagnosis(startDiagnosis(result.job)).job;
const evaluated = evaluateCandidate(job, diagnosed.diagnosis, {
  rationale: "Replace the failing implementation with a bounded fix.",
  changed_files: ["core/autonomy/example.js"],
  changed_lines: 12,
  test_commands: ["node --check core/autonomy/example.js", "node core/autonomy/example.test.js"]
});
assert.strictEqual(evaluated.critic.decision, "PASS");
job = evaluated.job;
assert.strictEqual(job.state, "patching");

job = beginTesting(job);
assert.strictEqual(job.state, "testing");
assert.strictEqual(job.attempts, 1);

job = recordTest(job, { passed: false, command: "node test.js", exitCode: 1 });
assert.strictEqual(job.state, "patching");
assert.strictEqual(job.attempts, 1);

job = beginTesting(job);
assert.strictEqual(job.attempts, 2);
job = recordTest(job, { passed: true, command: "node test.js", exitCode: 0 });
assert.strictEqual(job.state, "proven");

const receipt = buildReceipt(
  job,
  diagnosed.diagnosis,
  evaluated.repair,
  evaluated.critic,
  { passed: true, command: "node test.js", exitCode: 0 }
);
assert.strictEqual(receipt.status, "PROVEN");
assert.strictEqual(receipt.evidence.kill_critic, "PASS");

job = openPr(job, { number: 28, url: "https://github.com/smokblack999-a11y/Brand_Samuray-/pull/28", head: "x28-proof-to-ship-orchestrator" });
assert.strictEqual(job.state, "pr_open");

job = verifyPr(job, { passed: true, conclusion: "success" });
assert.strictEqual(job.state, "verified");

console.log("x28 proof-to-ship orchestrator tests: PASS");
