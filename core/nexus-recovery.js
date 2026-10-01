"use strict";

const crypto = require("node:crypto");
const policy = require("./nexus-resource-policy");
const { buildPatchProposal } = require("./interop/patch-proposal");

const MAX_RETRIES = 3;
const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolveFailureState(workflow = {}) {
  return FAILURE_CONCLUSIONS.has(String(workflow.conclusion || ""))
    ? "CI_FAILED"
    : "UNKNOWN";
}

function evaluateRecovery(input = {}) {
  const workflow = input.workflow || {};
  const fromState = resolveFailureState(workflow);

  if (!input.resource) {
    return { decision: "BLOCK", state: "BLOCKED", reason: "resource_identity_missing" };
  }

  if (!FAILURE_CONCLUSIONS.has(String(workflow.conclusion || ""))) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "recovery_requires_observed_ci_failure"
    };
  }

  const retryCount = Number.isInteger(input.retryCount) ? input.retryCount : 0;
  if (retryCount < 0 || retryCount >= MAX_RETRIES) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "retry_limit_exceeded",
      retryCount,
      maxRetries: MAX_RETRIES
    };
  }

  const diagnosis = input.diagnosis || {};
  if (diagnosis.reproduction !== true || diagnosis.causality !== true) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "reproduction_and_causality_required"
    };
  }

  let candidate;
  try {
    candidate = buildPatchProposal({
      evidenceOnly: true,
      reproduction: true,
      causality: true,
      diff: input.proposal?.diff,
      changedFiles: input.changedFiles,
      source: input.proposal?.source || "x10think"
    });
  } catch (error) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "proposal_validation_error",
      detail: String(error?.message || error)
    };
  }

  if (!candidate.accepted) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: candidate.reason
    };
  }

  const evaluation = policy.transition(fromState, "REPAIR_PROPOSED", {
    resource: input.resource,
    files: candidate.proposal.files,
    diff: candidate.proposal.diff,
    actor: input.actor || "x10think"
  });

  if (evaluation.decision !== "ALLOW") {
    return {
      ...evaluation,
      candidateAccepted: true
    };
  }

  return {
    ...evaluation,
    candidateAccepted: true,
    proposal: candidate.proposal,
    recoveryId: sha256({
      resource: input.resource,
      workflowRunId: workflow.id || null,
      retryCount,
      evaluationHash: evaluation.evaluationHash
    })
  };
}

function canExecute(result) {
  return Boolean(
    result &&
    result.decision === "ALLOW" &&
    result.state === "REPAIR_PROPOSED" &&
    result.candidateAccepted === true
  );
}

function buildWorkflowResource(workflow = {}) {
  const repo = workflow.repository || workflow.head_repository || {};
  const fullName = repo.full_name || workflow.repository_full_name;
  const runId = workflow.id;
  if (!fullName || !runId) return null;
  return `github://${fullName}/actions/runs/${runId}`;
}

module.exports = {
  MAX_RETRIES,
  FAILURE_CONCLUSIONS,
  resolveFailureState,
  buildWorkflowResource,
  evaluateRecovery,
  canExecute
};
