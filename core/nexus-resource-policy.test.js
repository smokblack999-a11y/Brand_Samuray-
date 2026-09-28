"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const nexus=require("./nexus-resource-policy");

test("15 real-life gates classify correctly",()=>{
  const cases=[
    ["auth/login.js","authentication"],["crypto/key.js","cryptography"],["tls/client.js","tls"],
    ["acl/rbac.js","acl"],["policy/access.js","policy"],[".github/workflows/build.yml","github_actions"],
    ["Dockerfile","docker"],["src/app.test.js","tests"],["src/app_test.go","tests_convention"],
    ["package.json","dependencies"],["infra/terraform/main.tf","infrastructure"],
    ["config/app.yml","configuration"],["routes/users.js","api_surface"],
    ["db/migrations/001.sql","database"],["src/index.js","large_change"]
  ];
  assert.equal(cases.length,15);
  for(const [file,category] of cases){
    const input=file==="src/index.js"?Array.from({length:20},(_,i)=>"src/file"+i+".js"):[file];
    assert.ok(nexus.classifyFiles(input).categories.includes(category),file);
  }
});

test("invalid state transition is blocked",()=>{
  const r=nexus.transition("REPAIR_PROPOSED","CI_PASSED",{resource:"github://repo/pull/1",files:["auth/login.js"]});
  assert.equal(r.decision,"BLOCK"); assert.equal(r.state,"BLOCKED");
  assert.ok(r.reasons.includes("invalid_state_transition"));
});

test("dangerous diff is fail-closed",()=>{
  const r=nexus.transition("CI_FAILED","REPAIR_PROPOSED",{resource:"github://repo/pull/2",files:["src/index.js"],diff:"rm -rf /"});
  assert.equal(r.decision,"BLOCK"); assert.ok(r.reasons.includes("dangerous_change_pattern"));
});

test("critical transition requires proof and validation",()=>{
  const r=nexus.transition("CI_PASSED","READY_FOR_REVIEW",{resource:"github://repo/pull/3",files:[".github/workflows/build.yml"]});
  assert.equal(r.decision,"ALLOW");
  assert.deepEqual(r.requiredChecks,["sandbox","ci","proof_receipt","human_review"]);
});

test("proof binds evaluation",()=>{
  const e=nexus.transition("CI_PASSED","READY_FOR_REVIEW",{resource:"github://repo/pull/4",files:["crypto/key.js"]});
  const p=nexus.createProofReceipt({evaluation:e,beforeSha:"abc",afterSha:"def",validations:["sandbox","ci"]});
  assert.equal(p.schema,"nexus-proof-receipt/v2"); assert.equal(p.proofHash.length,64);
  assert.equal(p.evaluationHash,e.evaluationHash);
});

test("missing identity blocks",()=>{
  const r=nexus.transition("CI_FAILED","REPAIR_PROPOSED",{resource:"",files:["src/index.js"]});
  assert.equal(r.decision,"BLOCK"); assert.ok(r.reasons.includes("resource_identity_missing"));
});
