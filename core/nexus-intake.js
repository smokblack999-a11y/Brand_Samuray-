"use strict";

const crypto = require("crypto");

function normalizeWorkflowRun(payload = {}) {
  const run = payload.workflow_run || payload;
  const repository = payload.repository || {};
  if (!run || !run.id || !repository.full_name) {
    const error = new Error("workflow_run and repository.full_name are required");
    error.code = "INVALID_WORKFLOW_EVENT";
    throw error;
  }
  const conclusion = run.conclusion == null ? null : String(run.conclusion);
  return {
    eventId: String(payload.deliveryId || payload.id || crypto.randomUUID()),
    runId: Number(run.id),
    workflowName: String(run.name || "unknown"),
    status: String(run.status || "unknown"),
    conclusion,
    repository: String(repository.full_name),
    headSha: String(run.head_sha || ""),
    baseSha: String(run.head_branch || ""),
    htmlUrl: String(run.html_url || "")
  };
}

function shouldEnqueue(event) {
  return Boolean(
    event &&
    event.repository &&
    event.runId &&
    event.status === "completed" &&
    event.conclusion === "failure"
  );
}

module.exports = { normalizeWorkflowRun, shouldEnqueue };
