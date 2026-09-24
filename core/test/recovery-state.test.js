"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { STATES, TRANSITIONS, transition, verifyProof, requiredProofFields, proofBindsToJob } = require("../x10thinc/recovery-state");

function baseJob(state = STATES.PR_READY) {
  return { id:"recovery-1234567890abcdef12345678", repository:"smokblack999-a11y/Brand_Samuray-", headSha:"abc123", diffHash:"diff-456", state };
}
function goodProof() {
  return {
    jobId:baseJob().id, repository:baseJob().repository, headSha:"abc123", diffHash:"diff-456",
    verificationRunId:987, patchApplied:true, sandboxPassed:true, testsPassed:true,
    ciPassed:true, invariantsPassed:true, evidenceComplete:true, autonomousMerge:false
  };
}
function expectRejected(proof, reason="PROOF_FIELDS_INCOMPLETE") {
  const r=transition(baseJob(),STATES.VERIFIED,{proof});
  assert.equal(r.ok,false); assert.ok(r.proof.reasons.includes(reason));
}

test("01 no proof cannot become verified",()=>{const r=transition(baseJob(),STATES.VERIFIED,{proof:{}});assert.equal(r.code,"NO_PROOF_NO_TRUSTED_STATE");assert.equal(r.job.state,STATES.HUMAN_REVIEW);});
test("02 sandbox is mandatory",()=>expectRejected({...goodProof(),sandboxPassed:false}));
test("03 tests are mandatory",()=>expectRejected({...goodProof(),testsPassed:false}));
test("04 CI is mandatory",()=>expectRejected({...goodProof(),ciPassed:false}));
test("05 invariants are mandatory",()=>expectRejected({...goodProof(),invariantsPassed:false}));
test("06 evidence is mandatory",()=>expectRejected({...goodProof(),evidenceComplete:false}));
test("07 patch application is mandatory",()=>expectRejected({...goodProof(),patchApplied:false}));
test("08 job id binds proof",()=>expectRejected({...goodProof(),jobId:"other"},"PROOF_BINDING_MISMATCH"));
test("09 repository binds proof",()=>expectRejected({...goodProof(),repository:"other/repo"},"PROOF_BINDING_MISMATCH"));
test("10 head SHA binds proof",()=>expectRejected({...goodProof(),headSha:"other"},"PROOF_BINDING_MISMATCH"));
test("11 diff hash binds proof",()=>expectRejected({...goodProof(),diffHash:"other"},"PROOF_BINDING_MISMATCH"));
test("12 verification run id must be integer",()=>expectRejected({...goodProof(),verificationRunId:"987"}));
test("13 autonomous merge is forbidden",()=>expectRejected({...goodProof(),autonomousMerge:true},"AUTONOMOUS_MERGE_MUST_REMAIN_FALSE"));
test("14 valid proof reaches verified",()=>{const r=transition(baseJob(),STATES.VERIFIED,{proof:goodProof()});assert.equal(r.ok,true);assert.equal(r.job.state,STATES.VERIFIED);});
test("15 verified is terminal",()=>{const r=transition({...baseJob(),state:STATES.VERIFIED},STATES.PR_READY,{});assert.equal(r.code,"INVALID_STATE_TRANSITION");});
test("16 frozen is terminal",()=>{const r=transition({...baseJob(),state:STATES.FROZEN},STATES.DIAGNOSING,{});assert.equal(r.code,"INVALID_STATE_TRANSITION");});
test("17 queued can diagnose",()=>assert.equal(transition(baseJob(STATES.QUEUED),STATES.DIAGNOSING,{}).ok,true));
test("18 diagnosing can propose",()=>assert.equal(transition(baseJob(STATES.DIAGNOSING),STATES.PATCH_PROPOSED,{}).ok,true));
test("19 proposal can sandbox",()=>assert.equal(transition(baseJob(STATES.PATCH_PROPOSED),STATES.SANDBOXED,{}).ok,true));
test("20 sandbox can prepare PR",()=>assert.equal(transition(baseJob(STATES.SANDBOXED),STATES.PR_READY,{}).ok,true));
test("21 PR can retry",()=>assert.equal(transition(baseJob(STATES.PR_READY),STATES.RETRYABLE,{}).ok,true));
test("22 retryable can diagnose",()=>assert.equal(transition(baseJob(STATES.RETRYABLE),STATES.DIAGNOSING,{}).ok,true));
test("23 diagnosing can human review",()=>assert.equal(transition(baseJob(STATES.DIAGNOSING),STATES.HUMAN_REVIEW,{}).ok,true));
test("24 human review can freeze",()=>assert.equal(transition(baseJob(STATES.HUMAN_REVIEW),STATES.FROZEN,{}).ok,true));
test("25 required proof validator rejects missing identity",()=>assert.equal(requiredProofFields({...goodProof(),jobId:""}),false));
test("26 exact proof binding passes",()=>assert.equal(proofBindsToJob(baseJob(),goodProof()),true));
test("27 transition table exposes no direct queued-to-verified path",()=>assert.equal(TRANSITIONS.get(STATES.QUEUED).has(STATES.VERIFIED),false));
test("28 proof verifier passes complete proof",()=>assert.equal(verifyProof(baseJob(),goodProof()).passed,true));
test("29 receipt is deterministic",()=>{const a=transition(baseJob(),STATES.VERIFIED,{proof:goodProof()});const b=transition(baseJob(),STATES.VERIFIED,{proof:goodProof()});assert.equal(a.job.proofReceipt.receiptHash,b.job.proofReceipt.receiptHash);});
test("30 valid proof still cannot enable autonomous merge",()=>{const p=goodProof();const r=transition(baseJob(),STATES.VERIFIED,{proof:p});assert.equal(r.job.proofReceipt.gates.autonomousMerge,false);});
