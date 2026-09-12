"use strict";

const crypto = require("crypto");

function isCompletedFailure(payload = {}) {
  return payload?.action === "completed" && payload?.workflow_run?.conclusion === "failure";
}

function normalizeWorkflowRun(payload = {}) {
  if (!isCompletedFailure(payload)) return null;
  const run = payload.workflow_run;
  const repository = payload.repository?.full_name || run.repository?.full_name || "";
  const runId = String(run.id || "");
  if (!repository || !runId) return null;
  return {
    jobId: `gh-${repository.replace(/[^a-zA-Z0-9_-]/g, "-")}-${runId}`,
    source: "github.workflow_run",
    repository,
    workflow: String(run.name || ""),
    runId,
    runUrl: String(run.html_url || ""),
    headSha: String(run.head_sha || ""),
    baseSha: String(run.head_branch || ""),
    conclusion: String(run.conclusion || "failure"),
    status: "QUEUED",
    dedupeKey: crypto.createHash("sha256").update(`${repository}:${runId}`).digest("hex")
  };
}

module.exports = { isCompletedFailure, normalizeWorkflowRun };
