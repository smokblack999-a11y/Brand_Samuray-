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
function gate(id, verification) {
  const job = store.getJob(id);
  if (!job) throw new Error("recovery job not found");
  const decision = critic.evaluate({ ...verification, attempts: job.attempts, ...job.budget });
  if (decision.decision === "recovered") {
    return store.createProof(job, "recovered", verification);
  }
  return store.updateJob(id, { status: decision.decision, lastDecision: decision });
}
module.exports = { ...store, ...state, ...critic, ...github, ...rootCause, ...patchPlan, enqueueFromGithub, diagnoseJob, startJob, recordAction, gate };
