"use strict";

const store = require("./store");
const state = require("./state");
const critic = require("./kill-critic");
const github = require("./github");
const rootCause = require("./root-cause");
const patchPlan = require("./patch-plan");

function enqueueFromGithub(payload, evidence = []) {
  const failure = github.normalizeWorkflowFailure(payload);
  if (!github.isRecoverableFailure(payload)) return { queued: false, reason: "not_recoverable_failure", failure };
  const id = `github:${failure.repo}:${failure.runId}`;
  const job = store.createJob({ id, source: failure, failure, evidence });
  return { queued: true, job };
}
function diagnoseJob(id) {
  const job = store.getJob(id);
  if (!job) throw new Error("recovery job not found");
  const diagnosis = rootCause.diagnose(job.failure, job.evidence);
  const plans = patchPlan.buildPatchPlan(diagnosis.hypotheses, job.budget);
  return store.updateJob(id, { hypotheses: diagnosis.hypotheses, patchPlans: plans });
}
function startJob(id) {
  const job = store.getJob(id);
  if (!job) throw new Error("recovery job not found");
  if (job.status === "queued" || job.status === "retryable" || job.status === "failed") return store.updateJob(id, { status: "running", attempts: Number(job.attempts || 0) + 1 });
  throw new Error(`job cannot start from state ${job.status}`);
}
function recordAction(id, action) {
  const job = store.getJob(id);
  if (!job) throw new Error("recovery job not found");
  const actions = [...job.actions, { ...action, at: new Date().toISOString() }];
  return store.updateJob(id, { actions });
}
function updateRecoveryCi(payload = {}) {
  const run = payload.workflow_run || payload;
  const repo = payload.repository?.full_name || run.repository?.full_name || null;
  const sha = run.head_sha || null;
  const branch = run.head_branch || null;
  const conclusion = run.conclusion || null;
  if (!repo || !sha || !conclusion) return { updated: false, reason: "invalid_workflow_run" };

  const jobs = store.listJobs(500);
  const job = jobs.find(candidate =>
    candidate.source?.repo === repo &&
    candidate.recovery?.commitSha === sha
  );
  if (!job) return { updated: false, reason: "recovery_job_not_found" };

  const ci = {
    runId: run.id != null ? String(run.id) : null,
    sha,
    branch,
    workflow: run.name || null,
    status: run.status || null,
    conclusion,
    url: run.html_url || null,
    verifiedAt: new Date().toISOString()
  };
  const actions = [...(job.actions || []), { type: "recovery_ci", ci, at: new Date().toISOString() }];
  const passed = conclusion === "success" && sha === job.recovery.commitSha;
  const next = store.updateJob(job.id, {
    recovery: { ...(job.recovery || {}), ciRunId: ci.runId, ciConclusion: conclusion, ciSha: sha, ciUrl: ci.url },
    verification: { ...(job.verification || {}), ciPassed: passed, ci },
    actions
  });
  if (!passed && ["failure","timed_out","cancelled","startup_failure"].includes(conclusion)) {
    return { updated: true, job: store.updateJob(job.id, { status: "retryable", lastDecision: { decision: "retryable", reason: "recovery_ci_failed", ci } }) };
  }
  if (passed) {
    const verification = {
      ...(next.verification || {}),
      patchApplied: next.verification?.patchApplied === true,
      sandboxPassed: next.verification?.sandboxPassed === true,
      testsPassed: next.verification?.testsPassed === true,
      ciPassed: true,
      regressionDetected: next.verification?.regressionDetected === true,
      filesChanged: next.verification?.filesChanged || [],
      runtimeSeconds: next.verification?.runtimeSeconds || 0
    };
    return { updated: true, job: gate(job.id, verification) };
  }
  return { updated: true, job: next };
}

function gate(id, verification) {
  const job = store.getJob(id);
  if (!job) throw new Error("recovery job not found");
  const persistedCi = job.verification?.ci;
  const ciVerified = Boolean(
    job.verification?.ciPassed === true &&
    persistedCi?.conclusion === "success" &&
    persistedCi?.sha &&
    job.recovery?.commitSha &&
    persistedCi.sha === job.recovery.commitSha
  );
  const decision = critic.evaluate({
    ...verification,
    ciPassed: ciVerified,
    ciVerified,
    attempts: job.attempts,
    ...job.budget
  });
  if (decision.decision === "recovered") {
    return store.createProof(job, "recovered", verification);
  }
  return store.updateJob(id, { status: decision.decision, lastDecision: decision });
}
module.exports = { ...store, ...state, ...critic, ...github, ...rootCause, ...patchPlan, enqueueFromGithub, diagnoseJob, startJob, recordAction, gate, updateRecoveryCi };
