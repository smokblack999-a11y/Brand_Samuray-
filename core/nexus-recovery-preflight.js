"use strict";

const policy = require("../nexus-resource-policy");

function evaluatePreflight(input = {}) {
  const conclusion = String(input.conclusion || "");
  const resource = String(input.resource || "");
  const headSha = String(input.headSha || "");
  const baseSha = String(input.baseSha || "");
  const files = Array.isArray(input.files) ? input.files : [];
  const diff = String(input.diff || "");

  if (!resource || !headSha) {
    return { decision: "BLOCK", state: "BLOCKED", reason: "recovery_identity_missing" };
  }

  if (!["failure", "timed_out", "startup_failure"].includes(conclusion)) {
    return { decision: "SKIP", reason: "workflow_not_recoverable", conclusion };
  }

  const evaluation = policy.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource,
    files,
    diff,
    actor: "github-workflow"
  });

  return Object.freeze({
    ...evaluation,
    workflowConclusion: conclusion,
    headSha,
    baseSha
  });
}

module.exports = { evaluatePreflight };
