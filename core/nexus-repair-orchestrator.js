"use strict";

const crypto = require("node:crypto");
const policy = require("./nexus-resource-policy");

const MAX_ATTEMPTS = 3;

const JOB_STATES = Object.freeze([
  "QUEUED",
  "DIAGNOSING",
  "REPAIR_PROPOSED",
  "CRITIC_BLOCKED",
  "SANDBOX_REQUIRED",
  "SANDBOX_FAILED",
  "CI_REQUIRED",
  "CI_FAILED",
  "PROOF_READY",
  "READY_FOR_REVIEW",
  "STOPPED"
]);

const EDGES = Object.freeze({
  QUEUED: ["DIAGNOSING", "STOPPED"],
  DIAGNOSING: ["REPAIR_PROPOSED", "STOPPED"],
  REPAIR_PROPOSED: ["CRITIC_BLOCKED", "SANDBOX_REQUIRED", "STOPPED"],
  CRITIC_BLOCKED: ["REPAIR_PROPOSED", "STOPPED"],
  SANDBOX_REQUIRED: ["SANDBOX_FAILED", "CI_REQUIRED", "STOPPED"],
  SANDBOX_FAILED: ["REPAIR_PROPOSED", "STOPPED"],
  CI_REQUIRED: ["CI_FAILED", "PROOF_READY", "STOPPED"],
  CI_FAILED: ["REPAIR_PROPOSED", "STOPPED"],
  PROOF_READY: ["READY_FOR_REVIEW", "STOPPED"],
  READY_FOR_REVIEW: [],
  STOPPED: []
});

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createJob(event, options = {}) {
  if (!event || !event.resource) throw new Error("resource_identity_missing");
  return {
    schema: "nexus-repair-job/v2",
    jobId: options.jobId || crypto.randomUUID(),
    resource: String(event.resource),
    workflowRunId: event.workflowRunId || null,
    changedFiles: policy.normalizeFiles(event.changedFiles),
    headSha: event.headSha || null,
    failure: {
      conclusion: event.conclusion || "failure",
      message: event.message || null
    },
    attempt: 0,
    maxAttempts: Number.isInteger(options.maxAttempts) ? options.maxAttempts : MAX_ATTEMPTS,
    state: "QUEUED",
    eventHash: hash(event)
  };
}

function nextState(job, next, evidence = {}) {
  if (!job || !EDGES[job.state]?.includes(next)) {
    throw new Error("invalid_job_transition:" + job?.state + "->" + next);
  }
  return Object.freeze({
    ...job,
    state: next,
    evidence: {...(job.evidence || {}), ...evidence},
    transitionHash: hash({
      jobId: job.jobId,
      from: job.state,
      to: next,
      evidence
    })
  });
}

function evaluateRepair(job, proposal = {}) {
  const evaluation = policy.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: job.resource,
    files: proposal.changedFiles || job.changedFiles,
    diff: proposal.diff || "",
    actor: proposal.actor || "x10think"
  });

  if (evaluation.decision === "BLOCK") {
    return {
      job: nextState(job, "CRITIC_BLOCKED", {critic: evaluation}),
      evaluation
    };
  }

  return {
    job: nextState(job, "SANDBOX_REQUIRED", {critic: evaluation}),
    evaluation
  };
}

function recordSandbox(job, result) {
  if (!result || typeof result.passed !== "boolean") {
    throw new Error("sandbox_result_required");
  }

  if (result.passed) {
    return nextState(job, "CI_REQUIRED", {
      sandbox: {passed: true, runId: result.runId || null}
    });
  }

  const attempt = job.attempt + 1;
  return nextState(
    {...job, attempt},
    attempt >= job.maxAttempts ? "STOPPED" : "SANDBOX_FAILED",
    {sandbox: {passed: false, runId: result.runId || null}}
  );
}

function recordCI(job, result) {
  if (!result || !["success", "failure"].includes(result.conclusion)) {
    throw new Error("ci_result_required");
  }

  if (result.conclusion === "success") {
    return nextState(job, "PROOF_READY", {
      ci: {conclusion: "success", runId: result.runId || null}
    });
  }

  const attempt = job.attempt + 1;
  return nextState(
    {...job, attempt},
    attempt >= job.maxAttempts ? "STOPPED" : "CI_FAILED",
    {ci: {conclusion: "failure", runId: result.runId || null}}
  );
}

function finalizeProof(job, {afterSha, validations = []} = {}) {
  if (job.state !== "PROOF_READY") {
    throw new Error("proof_requires_ci_success");
  }

  const evaluation = policy.evaluate({
    resource: job.resource,
    fromState: "CI_PASSED",
    toState: "READY_FOR_REVIEW",
    files: job.changedFiles,
    diff: "",
    actor: "x10think"
  });

  if (evaluation.decision !== "ALLOW") {
    throw new Error("proof_requires_allowed_transition");
  }

  const receipt = policy.createProofReceipt({
    evaluation,
    beforeSha: job.headSha,
    afterSha: afterSha || job.headSha,
    validations: [...new Set(["critic", "sandbox", "ci", ...validations])]
  });

  return {
    job: nextState(job, "READY_FOR_REVIEW", {proof: receipt}),
    receipt
  };
}

module.exports = {
  MAX_ATTEMPTS,
  JOB_STATES,
  createJob,
  nextState,
  evaluateRepair,
  recordSandbox,
  recordCI,
  finalizeProof
};
