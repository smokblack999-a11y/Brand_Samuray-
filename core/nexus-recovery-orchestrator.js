"use strict";

const gate = require("./nexus-recovery-gate");

async function runRecovery(input = {}) {
  const evaluated = gate.evaluateRecovery(input);

  if (!gate.canExecute(evaluated)) {
    return Object.freeze({
      decision: evaluated.decision || "BLOCK",
      state: evaluated.state || "BLOCKED",
      evaluated
    });
  }

  const executor = input.executor;
  if (!executor || typeof executor.applyPatch !== "function") {
    return Object.freeze({
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "x29_executor_missing",
      evaluated
    });
  }

  const execution = await executor.applyPatch({
    resource: evaluated.resource,
    proposal: evaluated.proposal,
    recoveryId: evaluated.recoveryId,
    evaluationHash: evaluated.evaluationHash,
    writeScope: evaluated.executionContract.writeScope
  });

  if (!execution || execution.applied !== true) {
    return Object.freeze({
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "patch_application_not_verified",
      evaluated,
      execution: execution || null
    });
  }

  if (typeof executor.verify !== "function") {
    return Object.freeze({
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "x29_verifier_missing",
      evaluated,
      execution
    });
  }

  const verification = await executor.verify({
    resource: evaluated.resource,
    recoveryId: evaluated.recoveryId,
    evaluationHash: evaluated.evaluationHash,
    proposal: evaluated.proposal,
    execution
  });

  const contract = gate.buildVerificationContract(evaluated, verification || {});
  if (!contract.readyForProof) {
    return Object.freeze({
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "verification_incomplete",
      evaluated,
      execution,
      verification,
      contract
    });
  }

  const final = gate.finalizeRecovery({
    resource: evaluated.resource,
    changedFiles: evaluated.proposal.files,
    diff: evaluated.proposal.diff,
    actor: input.actor || "x10think",
    evidence: {
      patch_applied: execution.applied === true,
      sandbox_passed: verification.sandbox === true,
      tests_passed: verification.tests_passed === true,
      ci_passed: verification.ci === true,
      invariants_passed: verification.invariants_passed === true,
      evidence_complete: true
    }
  });

  if (final.decision !== "ALLOW") {
    return Object.freeze({
      decision: "BLOCK",
      state: "BLOCKED",
      reason: "final_policy_rejected",
      evaluated,
      execution,
      verification,
      contract,
      final
    });
  }

  const proof = gate.createRecoveryProof({
    evaluation: final,
    recoveryId: evaluated.recoveryId,
    workflowRunId: input.workflow?.id,
    beforeSha: execution.beforeSha,
    afterSha: execution.afterSha,
    verificationRunId: verification.runId,
    evidence: final.evidence
  });

  if (typeof executor.persistProof === "function") {
    await executor.persistProof(proof);
  }

  return Object.freeze({
    decision: "ALLOW",
    state: "READY_FOR_REVIEW",
    evaluated,
    execution,
    verification,
    contract,
    final,
    proof
  });
}

module.exports = { runRecovery };
