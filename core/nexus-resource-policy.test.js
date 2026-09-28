"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const nexus=require("./nexus-resource-policy");

test("15 real-life gates are represented",()=>{
  const cases=[
    ["auth/","HIGH"],["crypto/","HIGH"],["tls/","HIGH"],["acl/","HIGH"],
    ["policy/","HIGH"],[".github/workflows/build.yml","HIGH"],["Dockerfile","HIGH"],
    ["src/app.test.js","HIGH"],["src/app_test.go","HIGH"],
    ["src/index.js","NORMAL"],["docs/readme.md","NORMAL"],["package.json","NORMAL"],
    ["infra/deploy.yml","NORMAL"],["src/config.js","NORMAL"],["src/api.js","NORMAL"]
  ];
  assert.equal(cases.length,15);
  for(const [file,expected] of cases) assert.equal(nexus.classifyFiles([file]).criticality,expected,file);
});

test("critical repair cannot skip sandbox",()=>{
  const result=nexus.transition("REPAIR_PROPOSED","CI_PASSED",{
    resource:"github://repo/pull/1",files:["auth/login.js"]
  });
  assert.equal(result.decision,"BLOCK");
  assert.ok(result.reasons.includes("invalid_state_transition"));
  assert.equal(result.state,"BLOCKED");
});

test("normal repair follows controlled state machine",()=>{
  const result=nexus.transition("REPAIR_PROPOSED","SANDBOX_PASSED",{
    resource:"github://repo/pull/2",files:["src/index.js"]
  });
  assert.equal(result.decision,"ALLOW");
  assert.equal(result.state,"SANDBOX_PASSED");
  assert.ok(result.requiredChecks.includes("sandbox"));
});

test("dangerous diff is fail-closed",()=>{
  const result=nexus.transition("CI_FAILED","REPAIR_PROPOSED",{
    resource:"github://repo/pull/3",files:["src/index.js"],diff:"RUN rm -rf /tmp/build"
  });
  assert.equal(result.decision,"BLOCK");
  assert.ok(result.reasons.includes("dangerous_change_pattern"));
});

test("proof receipt binds validated transition",()=>{
  const evaluation=nexus.transition("CI_PASSED","READY_FOR_REVIEW",{
    resource:"github://repo/pull/4",files:[".github/workflows/build.yml"]
  });
  assert.equal(evaluation.decision,"ALLOW");
  const receipt=nexus.createProofReceipt({
    evaluation,beforeSha:"abc",afterSha:"def",validations:["syntax","sandbox","ci"]
  });
  assert.equal(receipt.schema,"nexus-proof-receipt/v2");
  assert.equal(receipt.transition.from,"CI_PASSED");
  assert.equal(receipt.transition.to,"READY_FOR_REVIEW");
  assert.equal(receipt.proofHash.length,64);
  assert.equal(receipt.evaluationHash,evaluation.evaluationHash);
});

test("missing identity is blocked",()=>{
  const result=nexus.transition("CI_FAILED","REPAIR_PROPOSED",{
    resource:"",files:["src/index.js"]
  });
  assert.equal(result.decision,"BLOCK");
  assert.ok(result.reasons.includes("resource_identity_missing"));
});
