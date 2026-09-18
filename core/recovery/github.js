"use strict";

function normalizeWorkflowFailure(payload = {}) {
  const run = payload.workflow_run || payload;
  const conclusion = run.conclusion || "unknown";
  return {
    repo: payload.repository?.full_name || run.repository?.full_name || null,
    runId: run.id != null ? String(run.id) : null,
    workflow: run.name || null,
    sha: run.head_sha || null,
    status: run.status || null,
    conclusion,
    branch: run.head_branch || null,
    url: run.html_url || null
  };
}
function isRecoverableFailure(payload = {}) {
  const f = normalizeWorkflowFailure(payload);
  return Boolean(f.repo && f.runId && ["failure","timed_out","cancelled","startup_failure"].includes(f.conclusion));
}
module.exports = { normalizeWorkflowFailure, isRecoverableFailure };
