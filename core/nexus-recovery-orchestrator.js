"use strict";

const {
  evaluateRecovery,
  canExecute,
  buildVerificationContract,
  finalizeRecovery,
  createRecoveryProof
} = require("./nexus-recovery-gate");

function requireMethod(object, name) {
  if (!object || typeof object[name] !== "function") {
    throw new Error("transport_method_required:" + name);
  }
}

async function executeRecovery(input = {}, adapters = {}) {
  const gate = evaluateRecovery(input);

  if (!canExecute(gate)) {
    return Object.freeze({ phase: "BLOCKED", gate });
  }

  const github = adapters.github;
  const sandbox = adapters.sandbox;
  const ci = adapters.ci;

  requireMethod(github, "createRepairBranch");
  requireMethod(github, "applyPatch");
  requireMethod(github, "createPullRequest");
  requireMethod(sandbox, "run");
  requireMethod(ci, "waitForResult");

  const branch = await github.createRepairBranch({
    resource: gate.resource,
    recoveryId: gate.recoveryId,
    evaluationHash: gate.evaluationHash
  });

  const applied = await github.applyPatch({
    branch,
    proposal: gate.proposal,
    evaluationHash: gate.evaluationHash
  });

  if (!applied || applied.success !== true) {
    return Object.freeze({ phase: "EXECUTION_FAILED", gate, reason: "patch_application_failed", branch });
  }

  const sandboxResult = await sandbox.run({
    branch,
    resource: gate.resource,
    changedFiles: gate.changedFiles,
    evaluationHash: gate.evaluationHash
  });

  if (!sandboxResult || sandboxResult.passed !== true) {
    return Object.freeze({ phase: "SANDBOX_FAILED", gate, branch, sandbox: sandboxResult || null });
  }

  const ciResult = await ci.waitForResult({
    branch,
    resource: gate.resource,
    evaluationHash: gate.evaluationHash
  });

  if (!ciResult || ciResult.passed !== true) {
    return Object.freeze({ phase: "CI_FAILED", gate, branch, sandbox: sandboxResult, ci: ciResult || null });
  }

  const verification = buildVerificationContract(gate, {
    sandbox: true,
    ci: true,
    proof_receipt: false
  });

  if (verification.missing.length !== 1 || verification.missing[0] !== "proof_receipt") {
    return Object.freeze({ phase: "VERIFICATION_FAILED", gate, branch, verification });
  }

  const pr = await github.createPullRequest({
    branch,
    resource: gate.resource,
    draft: true,
    evaluationHash: gate.evaluationHash
  });

  if (!pr || pr.created !== true) {
    return Object.freeze({ phase: "PR_FAILED", gate, branch, sandbox: sandboxResult, ci: ciResult, pr: pr || null });
  }

  const finalEvaluation = finalizeRecovery({
    resource: gate.resource,
    changedFiles: gate.changedFiles,
    diff: gate.proposal.diff,
    actor: gate.actor,
    evidence: {
      patch_applied: true,
      sandbox_passed: true,
      tests_passed: ciResult.testsPassed === true,
      ci_passed: true,
      invariants_passed: ciResult.invariantsPassed === true,
      evidence_complete: true
    }
  });

  if (finalEvaluation.decision !== "ALLOW") {
    return Object.freeze({ phase: "FINALIZATION_BLOCKED", gate, branch, sandbox: sandboxResult, ci: ciResult, pr, finalEvaluation });
  }

  const proof = createRecoveryProof({
    evaluation: finalEvaluation,
    recoveryId: gate.recoveryId,
    workflowRunId: input.workflow?.id || null,
    beforeSha: input.beforeSha || null,
    afterSha: applied.afterSha || null,
    verificationRunId: ciResult.runId || null,
    evidence: finalEvaluation.evidence
  });

  return Object.freeze({ phase: "READY_FOR_REVIEW", gate, branch, sandbox: sandboxResult, ci: ciResult, pr, finalEvaluation, proof });
}

module.exports = { executeRecovery };
