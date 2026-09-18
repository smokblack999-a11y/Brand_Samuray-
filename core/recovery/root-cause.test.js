"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {diagnose}=require("./root-cause");
const {buildPatchPlan}=require("./patch-plan");

test("diagnosis ranks matching failure evidence",()=>{
  const r=diagnose({conclusion:"failure"},["npm ERR! ERESOLVE unable to resolve dependency tree"]);
  assert.equal(r.hypotheses[0].type,"dependency_error");
});

test("diagnosis falls back to generic evidence collection",()=>{
  const r=diagnose({conclusion:"failure"},["opaque failure"]);
  assert.equal(r.hypotheses[0].type,"generic");
});

test("patch planner keeps bounded verified actions",()=>{
  const r=buildPatchPlan([{type:"test_failure",action:"inspect_failing_test_and_nearest_source"}],{maxFilesChanged:4});
  assert.deepEqual(r[0],{attempt:1,hypothesis:"test_failure",objective:"inspect_failing_test_and_nearest_source",maxFilesChanged:4,requiresSandbox:true,requiresTests:true,requiresCi:true,status:"planned"});
});
