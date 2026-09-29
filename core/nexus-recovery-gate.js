"use strict";

const crypto = require("crypto");
const policy = require("./nexus-resource-policy");
const { buildPatchProposal } = require("./interop/patch-proposal");

const MAX_RETRIES = 3;

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Pure X10THINC -> NEXUS recovery gate.
 * It never writes GitHub state. The existing X29 transport remains the executor.
 */
function evaluateRecovery(input = {}) {
  const workflow = input.workflow || {};
  const diagnosis = input.diagnosis || {};
  const proposal = input.proposal || {};

  const conclusion = String(workflow.conclusion || "");
  const fromState = conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure"
    ? "CI_FAILED"
    : String(input.fromState || "UNKNOWN");

  if (!input.resource) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "resource_identity_missing"
    };
  }

  if (!["failure", "timed_out", "startup_failure"].includes(conclusion) &&
      fromState === "CI_FAILED") {
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

  if (diagnosis.reproduction !== true || diagnosis.causality !== true) {
    return {
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "reproduction_and_causality_required"
    };
  }

  const candidate = buildPatchProposal({
    evidenceOnly: true,
    reproduction: true,
    causality: true,
    diff: proposal.diff,
    changedFiles: input.changedFiles,
    source: proposal.source || "x10think"
  });

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
    recoveryId: hash({
      resource: input.resource,
      workflowRunId: workflow.id || null,
      retryCount,
      evaluationHash: evaluation.evaluationHash
    })
  };
}

function canExecute(result) {
  return Boolean(result && result.decision === "ALLOW" &&
    result.state === "REPAIR_PROPOSED" &&
    result.candidateAccepted === true);
}

module.exports = {
  MAX_RETRIES,
  evaluateRecovery,
  canExecute
};
