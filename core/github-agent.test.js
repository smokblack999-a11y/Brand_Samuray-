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

test("failed repair PR reuses the existing job instead of creating another job", () => {
  const repairPayload = {
    action: "completed",
    repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
    workflow_run: {
      id: 20001,
      run_attempt: 1,
      name: "SamuraiOS Core CI",
      status: "completed",
      conclusion: "failure",
      head_branch: "repair/job-123-abc123",
      head_sha: "repairsha1",
      html_url: "https://github.com/example/run/20001"
    }
  };
  const original = agent.ingestWorkflowRun({
    ...repairPayload,
    workflow_run: {
      ...repairPayload.workflow_run,
      id: 20000,
      head_branch: "feature/source",
      head_sha: "sourcesha"
    }
  });
  assert.equal(original.accepted, true);

  const stored = agent.transition(original.job.id, "diagnosing");
  assert.equal(stored.state, "diagnosing");
  const diagnosed = agent.transition(original.job.id, "diagnosed", {
    safeToPatch: true,
    branch: "repair/job-123-abc123"
  });
  assert.equal(diagnosed.state, "diagnosed");

  const failure = agent.ingestWorkflowRun(repairPayload);
  assert.equal(failure.repairFailure, true);
  assert.equal(failure.accepted, false);
  assert.equal(failure.job.id, original.job.id);
  assert.equal(failure.job.state, "queued");
  assert.equal(failure.job.repairFailures, 1);
  assert.equal(agent.list().filter(item => item.repository === repairPayload.repository.full_name).length, 1);
});

test("repeated repair PR failures stop the same job", () => {
  const payload = attempt => ({
    action: "completed",
    repository: { full_name: "repo/loop-test" },
    workflow_run: {
      id: 30000 + attempt,
      run_attempt: 1,
      name: "Core CI",
      status: "completed",
      conclusion: "failure",
      head_branch: "repair/loop-job",
      head_sha: `sha-${attempt}`
    }
  });
  const source = agent.ingestWorkflowRun({
    ...payload(0),
    workflow_run: { ...payload(0).workflow_run, head_branch: "feature/loop-source" }
  });
  assert.equal(source.accepted, true);
  agent.transition(source.job.id, "diagnosing");
  agent.transition(source.job.id, "diagnosed");

  const first = agent.ingestWorkflowRun(payload(1));
  assert.equal(first.job.state, "queued");
  const second = agent.ingestWorkflowRun(payload(2));
  assert.equal(second.job.state, "queued");
  const third = agent.ingestWorkflowRun(payload(3));
  assert.equal(third.job.state, "stopped");
  assert.equal(third.job.repairFailures, 3);
  assert.equal(agent.list().filter(item => item.repository === "repo/loop-test").length, 1);
});
