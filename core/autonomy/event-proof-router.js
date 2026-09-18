/**
 * X10THINC X26 Event Proof Router
 *
 * Converts a GitHub workflow_run completion into a deterministic repair job
 * input for the X25 proof-repair engine. It only plans work: no file edits,
 * push, merge, deployment, or network calls are performed here.
 */

const { diagnose } = require("./proof-repair-engine");

const CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "cancelled"
]);

function normalizeWorkflowRun(event) {
  const run = event?.workflow_run || event;
  if (!run || typeof run !== "object") throw new TypeError("workflow_run is required");

  const conclusion = String(run.conclusion || "").trim().toLowerCase();
  const id = String(run.id || "").trim();
  const repo = String(run.repository?.full_name || run.repository_full_name || "").trim();
  const sha = String(run.head_sha || "").trim();
  const branch = String(run.head_branch || "").trim();
  const workflow = String(run.name || run.workflow_name || "").trim();

  if (!id) throw new Error("missing workflow_run.id");
  if (!repo) throw new Error("missing repository.full_name");
  if (!sha) throw new Error("missing workflow_run.head_sha");
  if (!conclusion) throw new Error("missing workflow_run.conclusion");

  return Object.freeze({ id, repo, sha, branch, workflow, conclusion });
}

function buildJobKey(run) {
  const r = normalizeWorkflowRun(run);
  return `github:${r.repo}:${r.id}:${r.conclusion}`;
}

function routeWorkflowRun(event, { existingJobKeys = new Set() } = {}) {
  const run = normalizeWorkflowRun(event);
  const jobKey = buildJobKey(run);

  if (run.conclusion === "success") {
    return Object.freeze({ action: "ignore_success", jobKey, run });
  }
  if (!CONCLUSIONS.has(run.conclusion)) {
    return Object.freeze({ action: "ignore_unsupported", jobKey, run });
  }
  if (existingJobKeys.has(jobKey)) {
    return Object.freeze({ action: "dedupe", jobKey, run });
  }

  const failure = {
    failure_signature: `workflow_run:${run.workflow}:${run.conclusion}`,
    failing_step: run.workflow || "workflow_run",
    log: `GitHub workflow ${run.id} concluded with ${run.conclusion}`,
    reproducible: false,
    reproduction_reason: "workflow_run event does not contain step-level reproduction evidence"
  };

  return Object.freeze({
    action: "enqueue_repair",
    jobKey,
    job: Object.freeze({
      id: jobKey,
      repo: run.repo,
      sha: run.sha,
      branch: run.branch,
      runId: run.id,
      failure,
      diagnosis: diagnose(failure)
    })
  });
}

module.exports = { normalizeWorkflowRun, buildJobKey, routeWorkflowRun };
