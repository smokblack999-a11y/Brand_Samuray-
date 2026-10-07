"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const v=require("./samurai-verification-engine");

test("verification engine blocks missing mandatory behavior",async()=>{
  const result=await v.verify({
    task:"add payment guard",
    requirements:[
      {id:"PAY-1",mandatory:true,behavior:"payment must be idempotent"},
      {id:"PAY-2",mandatory:true,behavior:"duplicate payment must be rejected"}
    ],
    evidence:[{requirementId:"PAY-1",passed:true,evidence:"idempotency key observed"}],
    verifier:async({requirement})=>({passed:requirement.id==="PAY-1",evidence:requirement.id==="PAY-1"?"runtime proof":""}),
    regressionResults:[{name:"unit suite",passed:true}],
    trajectory:[{action:"verify PAY-1"}]
  });
  assert.equal(result.passed,false);
  assert.equal(result.mergeDecision,"BLOCK");
  assert.ok(result.failures.some(x=>x.type==="MISSED_REQUIREMENT"));
});

test("verification engine allows only fully verified behavior",async()=>{
  const result=await v.verify({
    task:"safe change",
    requirements:[{id:"REQ-1",mandatory:true,behavior:"returns safe result"}],
    verifier:async()=>({passed:true,evidence:"observable API returned expected result"}),
    regressionResults:[{name:"unit suite",passed:true}],
    trajectory:[{action:"test REQ-1"},{action:"verify REQ-1"}]
  });
  assert.equal(result.passed,true);
  assert.equal(result.mergeDecision,"ALLOW");
});

test("failure taxonomy is deterministic",()=>{
  assert.equal(v.classifyFailure({reason:"syntax parse error"}),"SYNTAX_ERROR");
  assert.equal(v.classifyFailure({reason:"existing test regression"}),"REGRESSION");
  assert.equal(v.classifyFailure({reason:"missing requirement acceptance"}),"MISSED_REQUIREMENT");
});
