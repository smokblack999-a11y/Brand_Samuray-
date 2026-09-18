"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {createProofReceipt,verifyProofReceipt}=require("./proof");
test("proof receipt is tamper evident",()=>{const r=createProofReceipt({id:"r1",source:{repo:"o/r"}},{ciPassed:true});assert.equal(verifyProofReceipt(r),true);r.verification.ciPassed=false;assert.equal(verifyProofReceipt(r),false);});
