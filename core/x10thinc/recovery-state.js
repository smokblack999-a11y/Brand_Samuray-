"use strict";

const crypto = require("node:crypto");

const STATES = Object.freeze({
  QUEUED: "queued",
  DIAGNOSING: "diagnosing",
  PATCH_PROPOSED: "patch_proposed",
  SANDBOXED: "sandboxed",
  PR_READY: "pr_ready",
  VERIFIED: "verified",
  RETRYABLE: "retryable",
  HUMAN_REVIEW: "human_review",
  FROZEN: "frozen"
});

const TRUSTED_STATES = new Set([STATES.VERIFIED]);

const TRANSITIONS = new Map([
  [STATES.QUEUED, new Set([STATES.DIAGNOSING, STATES.FROZEN])],
  [STATES.DIAGNOSING, new Set([STATES.PATCH_PROPOSED, STATES.HUMAN_REVIEW, STATES.FROZEN])],
  [STATES.PATCH_PROPOSED, new Set([STATES.SANDBOXED, STATES.HUMAN_REVIEW, STATES.FROZEN])],
  [STATES.SANDBOXED, new Set([STATES.PR_READY, STATES.RETRYABLE, STATES.HUMAN_REVIEW, STATES.FROZEN])],
  [STATES.PR_READY, new Set([STATES.VERIFIED, STATES.RETRYABLE, STATES.HUMAN_REVIEW, STATES.FROZEN])],
  [STATES.RETRYABLE, new Set([STATES.DIAGNOSING, STATES.FROZEN])],
  [STATES.HUMAN_REVIEW, new Set([STATES.FROZEN, STATES.VERIFIED])],
  [STATES.VERIFIED, new Set([])],
  [STATES.FROZEN, new Set([])]
]);

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value, Object.keys(value || {}).sort())).digest("hex");
}

function requiredProofFields(proof = {}) {
  return Boolean(proof &&
    proof.patchApplied === true &&
    proof.sandboxPassed === true &&
    proof.testsPassed === true &&
    proof.ciPassed === true &&
    proof.invariantsPassed === true &&
    proof.evidenceComplete === true &&
    String(proof.jobId || "") &&
    String(proof.repository || "") &&
    String(proof.headSha || "") &&
    Number.isInteger(proof.verificationRunId));
}

function proofBindsToJob(job = {}, proof = {}) {
  return String(proof.jobId) === String(job.id) &&
    String(proof.repository) === String(job.repository) &&
    String(proof.headSha) === String(job.headSha) &&
    Number.isInteger(proof.verificationRunId) &&
    String(proof.diffHash || "") === String(job.diffHash || "");
}

function verifyProof(job = {}, proof = {}) {
  const reasons = [];
  if (!requiredProofFields(proof)) reasons.push("PROOF_FIELDS_INCOMPLETE");
  if (!proofBindsToJob(job, proof)) reasons.push("PROOF_BINDING_MISMATCH");
  if (proof.autonomousMerge !== false) reasons.push("AUTONOMOUS_MERGE_MUST_REMAIN_FALSE");
  return { passed: reasons.length === 0, reasons };
}

function transition(job = {}, nextState, evidence = {}) {
  const from = String(job.state || STATES.QUEUED);
  const next = String(nextState || "");
  if (!TRANSITIONS.get(from)?.has(next)) {
    return { ok: false, code: "INVALID_STATE_TRANSITION", job };
  }

  if (next === STATES.VERIFIED) {
    const proof = verifyProof(job, evidence.proof || {});
    if (!proof.passed) {
      return {
        ok: false,
        code: "NO_PROOF_NO_TRUSTED_STATE",
        proof,
        job: { ...job, state: STATES.HUMAN_REVIEW }
      };
    }
    const receipt = {
      version: "x10thinc-proof-v2",
      type: "recovery.verification",
      jobId: job.id,
      repository: job.repository,
      headSha: job.headSha,
      verificationRunId: evidence.proof.verificationRunId,
      diffHash: job.diffHash,
      gates: {
        patchApplied: true,
        sandbox: true,
        tests: true,
        ci: true,
        invariants: true,
        evidenceComplete: true,
        autonomousMerge: false
      },
      receiptHash: stableHash({
        jobId: job.id,
        repository: job.repository,
        headSha: job.headSha,
        verificationRunId: evidence.proof.verificationRunId,
        diffHash: job.diffHash
      })
    };
    return { ok: true, job: { ...job, state: STATES.VERIFIED, proofReceipt: receipt } };
  }

  return { ok: true, job: { ...job, state: next } };
}

module.exports = { STATES, TRANSITIONS, TRUSTED_STATES, requiredProofFields, proofBindsToJob, verifyProof, transition };
