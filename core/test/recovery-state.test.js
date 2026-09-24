"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { STATES, transition, verifyProof } = require("../x10thinc/recovery-state");

function baseJob() {
  return {
    id: "recovery-123",
    repository: "smokblack999-a11y/Brand_Samuray-",
    headSha: "abc123",
    diffHash: "diff-456",
    state: STATES.PR_READY
  };
}

function goodProof() {
  return {
    jobId: "recovery-123",
    repository: "smokblack999-a11y/Brand_Samuray-",
    headSha: "abc123",
    diffHash: "diff-456",
    verificationRunId: 987,
    patchApplied: true,
    sandboxPassed: true,
    testsPassed: true,
    ciPassed: true,
    invariantsPassed: true,
    evidenceComplete: true,
    autonomousMerge: false
  };
}

test("No Proof -> No Trusted State Transition", () => {
  const r = transition(baseJob(), STATES.VERIFIED, { proof: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_PROOF_NO_TRUSTED_STATE");
  assert.equal(r.job.state, STATES.HUMAN_REVIEW);
});

test("missing sandbox cannot become verified", () => {
  const proof = { ...goodProof(), sandboxPassed: false };
  const r = transition(baseJob(), STATES.VERIFIED, { proof });
  assert.equal(r.ok, false);
  assert.ok(r.proof.reasons.includes("PROOF_FIELDS_INCOMPLETE"));
});

test("missing CI cannot become verified", () => {
  const proof = { ...goodProof(), ciPassed: false };
  const r = transition(baseJob(), STATES.VERIFIED, { proof });
  assert.equal(r.ok, false);
});

test("wrong head SHA cannot become verified", () => {
  const proof = { ...goodProof(), headSha: "attacker-sha" };
  const r = transition(baseJob(), STATES.VERIFIED, { proof });
  assert.equal(r.ok, false);
  assert.ok(r.proof.reasons.includes("PROOF_BINDING_MISMATCH"));
});

test("valid proof creates immutable verification receipt", () => {
  const r = transition(baseJob(), STATES.VERIFIED, { proof: goodProof() });
  assert.equal(r.ok, true);
  assert.equal(r.job.state, STATES.VERIFIED);
  assert.equal(r.job.proofReceipt.gates.autonomousMerge, false);
  assert.equal(r.job.proofReceipt.verificationRunId, 987);
  assert.match(r.job.proofReceipt.receiptHash, /^[a-f0-9]{64}$/);
});

test("invalid state transition is rejected", () => {
  const r = transition({ ...baseJob(), state: STATES.VERIFIED }, STATES.PR_READY, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_STATE_TRANSITION");
});

test("proof verifier requires exact job identity", () => {
  const proof = { ...goodProof(), jobId: "other-job" };
  assert.equal(verifyProof(baseJob(), proof).passed, false);
});
