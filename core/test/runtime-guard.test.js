"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {requiredEnv,validateRecoveryIdentity,assertNoUnverifiedOverride,receiptHash,verifyReceipt}=require("../x10thinc/runtime-guard");

test("production guard detects missing secrets",()=>{
  const missing=requiredEnv({CORE_API_KEY:"x",TELEGRAM_WEBHOOK_SECRET:"y",X10THINK_RECOVERY_API_KEY:"z"});
  assert.deepEqual(missing,["GITHUB_TOKEN"]);
});

test("recovery identity is strict",()=>{
  assert.equal(validateRecoveryIdentity({
    jobId:"recovery-0123456789abcdef01234567",
    repository:"smokblack999-a11y/Brand_Samuray-",
    headSha:"a".repeat(40),
    diffHash:"b".repeat(64)
  }).passed,true);
  assert.equal(validateRecoveryIdentity({jobId:"evil",repository:"x",headSha:"x",diffHash:"x"}).passed,false);
});

test("unverified CI override fails closed",()=>{
  assert.throws(()=>assertNoUnverifiedOverride({X10THINK_ALLOW_UNVERIFIED_CI:"true"}),/FORBIDDEN/);
});

test("receipt hash detects tampering",()=>{
  const receipt={version:"test",jobId:"r",headSha:"a".repeat(40)};
  const signed={...receipt,receiptHash:receiptHash(receipt)};
  assert.equal(verifyReceipt(signed).passed,true);
  assert.equal(verifyReceipt({...signed,jobId:"tampered"}).passed,false);
});
