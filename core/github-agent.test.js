"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-github-agent-"));
process.env.GITHUB_AGENT_MAX_RETRIES = "2";
const agent = require("./github-agent");

test("workflow_run failure is normalized and queued", () => {
  const payload = {
    action: "completed",
    repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
    workflow_run: {
      id: 12345,
      run_attempt: 1,
      name: "SamuraiOS Core CI",
      status: "completed",
      conclusion: "failure",
      head_branch: "feature/test",
      head_sha: "abc123",
      html_url: "https://github.com/example/run/12345"
    }
  };
  const first = agent.ingestWorkflowRun(payload);
  assert.equal(first.accepted, true);
  assert.equal(first.job.state, "queued");
  assert.equal(first.job.retries, 0);

  const duplicate = agent.ingestWorkflowRun(payload);
  assert.equal(duplicate.duplicate, true);
  assert.equal(agent.list().length, 1);
});

test("non-failure workflow does not enter queue", () => {
  const result = agent.ingestWorkflowRun({
    action: "completed",
    repository: { full_name: "repo/test" },
    workflow_run: { id: 999, conclusion: "success", status: "completed" }
  });
  assert.equal(result.accepted, false);
  assert.equal(agent.list().length, 1);
});

test("claim and bounded retry stop the job", () => {
  const job = agent.claim();
  assert.equal(job.state, "diagnosing");
  const retry1 = agent.retry(job.id, "diagnosis failed");
  assert.equal(retry1.state, "queued");
  const claimedAgain = agent.claim();
  const retry2 = agent.retry(claimedAgain.id, "patch failed");
  assert.equal(retry2.state, "queued");
  const claimedThird = agent.claim();
  const stopped = agent.retry(claimedThird.id, "verification failed");
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.retries, 3);
});
