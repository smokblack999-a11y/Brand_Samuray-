const assert = require("node:assert/strict");
const { routeWorkflowRun, buildJobKey } = require("./event-proof-router");

const event = { workflow_run: {
  id: 9001,
  name: "CI",
  conclusion: "failure",
  head_sha: "abc123",
  head_branch: "feature/demo",
  repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
}};

const first = routeWorkflowRun(event);
assert.equal(first.action, "enqueue_repair");
assert.equal(first.job.id, buildJobKey(event));
assert.equal(first.job.diagnosis.category, "generic");

const duplicate = routeWorkflowRun(event, { existingJobKeys: new Set([first.jobKey]) });
assert.equal(duplicate.action, "dedupe");

const success = routeWorkflowRun({ workflow_run: { ...event.workflow_run, conclusion: "success" } });
assert.equal(success.action, "ignore_success");

const unsupported = routeWorkflowRun({ workflow_run: { ...event.workflow_run, conclusion: "neutral" } });
assert.equal(unsupported.action, "ignore_unsupported");

console.log("X26 event-proof-router tests: PASS");
