"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {STATES,transition,verifyProof,requiredProofFields,proofBindsToJob}=require("../x10thinc/recovery-state");
const {recoveryJobFromBranch,normalizeWorkflowRun,diagnose}=require("../recovery-router");

const job={id:"recovery-0123456789abcdef01234567",repository:"smokblack999-a11y/Brand_Samuray-",headSha:"base-sha",diffHash:"diff-sha",state:STATES.PR_READY};
const proof={jobId:job.id,repository:job.repository,headSha:job.headSha,diffHash:job.diffHash,verificationRunId:42,patchApplied:true,sandboxPassed:true,testsPassed:true,ciPassed:true,invariantsPassed:true,evidenceComplete:true,autonomousMerge:false};

test("01 valid proof fields",()=>assert.equal(requiredProofFields(proof),true));
test("02 proof binds job",()=>assert.equal(proofBindsToJob(job,proof),true));
test("03 wrong job rejected",()=>assert.equal(proofBindsToJob(job,{...proof,jobId:"other"}),false));
test("04 wrong repo rejected",()=>assert.equal(proofBindsToJob(job,{...proof,repository:"other/repo"}),false));
test("05 wrong head rejected",()=>assert.equal(proofBindsToJob(job,{...proof,headSha:"other"}),false));
test("06 wrong diff rejected",()=>assert.equal(proofBindsToJob(job,{...proof,diffHash:"other"}),false));
test("07 missing CI rejected",()=>assert.equal(verifyProof(job,{...proof,ciPassed:false}).passed,false));
test("08 missing sandbox rejected",()=>assert.equal(verifyProof(job,{...proof,sandboxPassed:false}).passed,false));
test("09 missing invariants rejected",()=>assert.equal(verifyProof(job,{...proof,invariantsPassed:false}).passed,false));
test("10 incomplete evidence rejected",()=>assert.equal(verifyProof(job,{...proof,evidenceComplete:false}).passed,false));
test("11 autonomous merge rejected",()=>assert.equal(verifyProof(job,{...proof,autonomousMerge:true}).passed,false));
test("12 invalid transition rejected",()=>assert.equal(transition({...job,state:STATES.VERIFIED},STATES.PR_READY,{}).ok,false));
test("13 valid verification becomes trusted",()=>assert.equal(transition(job,STATES.VERIFIED,{proof}).job.state,STATES.VERIFIED));
test("14 receipt is hashed",()=>assert.match(transition(job,STATES.VERIFIED,{proof}).job.proofReceipt.receiptHash,/^[a-f0-9]{64}$/));
test("15 verified is terminal",()=>assert.equal(transition({...job,state:STATES.VERIFIED},STATES.HUMAN_REVIEW,{}).ok,false));
test("16 queued can diagnose",()=>assert.equal(transition({...job,state:STATES.QUEUED},STATES.DIAGNOSING,{}).ok,true));
test("17 diagnosis identifies syntax",()=>assert.equal(diagnose("SyntaxError: unexpected token").errorType,"syntax_error"));
test("18 diagnosis identifies dependency",()=>assert.equal(diagnose("npm ERR! module not found").errorType,"dependency_error"));
test("19 diagnosis identifies timeout",()=>assert.equal(diagnose("deadline exceeded").errorType,"timeout"));
test("20 diagnosis identifies auth",()=>assert.equal(diagnose("401 Unauthorized").errorType,"auth_error"));
test("21 diagnosis identifies OOM",()=>assert.equal(diagnose("exit code 137").errorType,"oom"));
test("22 recovery branch parses",()=>assert.equal(recoveryJobFromBranch("recovery/"+job.id),job.id));
test("23 unrelated branch rejected",()=>assert.equal(recoveryJobFromBranch("feature/test"),null));
test("24 workflow run normalized",()=>assert.equal(normalizeWorkflowRun({repository:{full_name:job.repository},workflow_run:{id:99,name:"CI",head_branch:"main",head_sha:"abc",conclusion:"failure"}}).runId,99));
test("25 successful run is not an ingress failure",()=>assert.equal(normalizeWorkflowRun({repository:{full_name:job.repository},workflow_run:{id:100,conclusion:"success"}}).conclusion,"success"));
test("26 proof requires numeric verification run",()=>assert.equal(requiredProofFields({...proof,verificationRunId:"42"}),false));
