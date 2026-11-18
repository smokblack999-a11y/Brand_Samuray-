"use strict";

const crypto = require("node:crypto");
const policy = require("./nexus-resource-policy");
const {verifySandboxAttestation, verifyCiRun} = require("./interop/sandbox-proof");

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
  DIAGNOSING: ["REPAIR_PROPOSED", "CRITIC_BLOCKED", "SANDBOX_REQUIRED", "STOPPED"],
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value || ""));
}

function resolveEventContext(event) {
  const workflowRun = event.workflow_run || {};
  const pullRequest = Array.isArray(event.pull_requests) ? event.pull_requests[0] : (event.pullRequest || {});
  const repository = event.repository?.full_name ||
    event.repository_full_name ||
    (typeof event.repository === "string" ? event.repository : null) ||
    pullRequest.base?.repo?.full_name ||
    null;

  return {
    repository,
    baseSha: event.baseSha || event.base_sha || event.base?.sha || pullRequest.base?.sha || null,
    headSha: event.headSha || event.head_sha || workflowRun.head_sha || event.head?.sha || pullRequest.head?.sha || null,
    workflowRunId: event.workflowRunId || workflowRun.id || null
  };
}

function createJob(event, options = {}) {
  if (!event || !event.resource) throw new Error("resource_identity_missing");
  const context = resolveEventContext(event);
  return {
    schema: "nexus-repair-job/v3",
    jobId: options.jobId || crypto.randomUUID(),
    resource: String(event.resource),
    repository: context.repository,
    baseSha: context.baseSha,
    headSha: context.headSha,
    workflowRunId: context.workflowRunId,
    changedFiles: policy.normalizeFiles(event.changedFiles),
    failure: {
      conclusion: event.conclusion || event.workflow_run?.conclusion || "failure",
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
  const diff = typeof proposal.diff === "string" ? proposal.diff : "";
  const evaluation = policy.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: job.resource,
    files: proposal.changedFiles || job.changedFiles,
    diff,
    actor: proposal.actor || "x10think"
  });

  if (evaluation.decision === "BLOCK") {
    return {
      job: nextState(job, "CRITIC_BLOCKED", {critic: evaluation}),
      evaluation
    };
  }

  const contextMissing = [];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(job.repository || ""))) {
    contextMissing.push("repository");
  }
  if (!isSha(job.baseSha)) contextMissing.push("base_sha");
  if (!isSha(job.headSha)) contextMissing.push("head_sha");
  if (!diff) contextMissing.push("candidate_patch");

  if (contextMissing.length) {
    const blocked = {
      ...evaluation,
      decision: "BLOCK",
      reasons: [...evaluation.reasons, "sandbox_proof_context_missing"],
      missingProofContext: contextMissing
    };
    return {
      job: nextState(job, "STOPPED", {critic: evaluation, proofGate: blocked}),
      evaluation: blocked
    };
  }

  const patchSha256 = sha256(Buffer.from(diff, "utf8"));
  const prepared = {...job, patchSha256};
  return {
    job: nextState(prepared, "SANDBOX_REQUIRED", {
      critic: evaluation,
      candidate: {
        repository: job.repository,
        baseSha: job.baseSha.toLowerCase(),
        headSha: job.headSha.toLowerCase(),
        patchSha256
      }
    }),
    evaluation
  };
}

async function recordSandbox(job, result) {
  if (!job || job.state !== "SANDBOX_REQUIRED") {
    throw new Error("sandbox_requires_sandbox_required_state");
  }
  if (!result || typeof result.receiptPath !== "string" || typeof result.patchPath !== "string") {
    throw new Error("sandbox_proof_required");
  }

  let proof;
  try {
    proof = await verifySandboxAttestation({
      receiptPath: result.receiptPath,
      patchPath: result.patchPath,
      expected: {
        repository: job.repository,
        baseSha: job.baseSha,
        headSha: job.headSha
      }
    });
    if (proof.patchSha256 !== job.patchSha256) {
      throw new Error("SANDBOX_PATCH_DOES_NOT_MATCH_CANDIDATE");
    }
  } catch (error) {
    const attempt = job.attempt + 1;
    const reason = String(error?.message || error).slice(0, 180);
    return nextState(
      {...job, attempt},
      attempt >= job.maxAttempts ? "STOPPED" : "SANDBOX_FAILED",
      {sandbox: {verified: false, reason}}
    );
  }

  return nextState(job, "CI_REQUIRED", {
    sandbox: {
      ...proof,
      verified: true
    }
  });
}

async function recordCI(job, result) {
  if (!job || job.state !== "CI_REQUIRED") {
    throw new Error("ci_requires_ci_required_state");
  }
  if (!result || !/^[1-9][0-9]*$/.test(String(result.runId || ""))) {
    throw new Error("ci_run_id_required");
  }

  const proof = await verifyCiRun({
    runId: result.runId,
    repository: job.repository,
    headSha: job.headSha
  });

  if (proof.conclusion === "success") {
    return nextState(job, "PROOF_READY", {
      ci: {...proof, verified: true}
    });
  }

  const attempt = job.attempt + 1;
  return nextState(
    {...job, attempt},
    attempt >= job.maxAttempts ? "STOPPED" : "CI_FAILED",
    {ci: {...proof, verified: true}}
  );
}

function finalizeProof(job, {afterSha} = {}) {
  if (!job || job.state !== "PROOF_READY") {
    throw new Error("proof_requires_ci_success");
  }

  const evidence = job.evidence || {};
  if (evidence.critic?.decision !== "ALLOW") {
    throw new Error("proof_requires_kill_critic_acceptance");
  }
  if (evidence.sandbox?.verified !== true ||
      evidence.sandbox.repository !== job.repository ||
      evidence.sandbox.baseSha !== String(job.baseSha).toLowerCase() ||
      evidence.sandbox.headSha !== String(job.headSha).toLowerCase() ||
      evidence.sandbox.patchSha256 !== job.patchSha256) {
    throw new Error("proof_requires_matching_attested_sandbox");
  }
  if (evidence.ci?.verified !== true ||
      evidence.ci.conclusion !== "success" ||
      evidence.ci.repository !== job.repository ||
      evidence.ci.headSha !== String(job.headSha).toLowerCase()) {
    throw new Error("proof_requires_matching_ci_run");
  }
  if (!isSha(job.baseSha) || !isSha(job.headSha) ||
      (afterSha && String(afterSha).toLowerCase() !== String(job.headSha).toLowerCase())) {
    throw new Error("proof_candidate_sha_mismatch");
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
    beforeSha: job.baseSha,
    afterSha: job.headSha,
    validations: ["critic", "sandbox", "ci", "github_attestation", "github_actions_ci"]
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
