"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {resolveTestOptions}=require("./worker");
const {evaluate}=require("./kill-critic");

test("worker defaults to bounded npm test execution",()=>{
  assert.deepEqual(resolveTestOptions({},{}),{command:"npm",args:["test"],timeoutMs:120000});
});

test("worker accepts executor-provided test command",()=>{
  assert.deepEqual(
    resolveTestOptions({testCommand:"node",testArgs:["--test"],testTimeoutMs:30000},{}),
    {command:"node",args:["--test"],timeoutMs:30000}
  );
});

test("Kill Critic never recovers without independently verified CI",()=>{
  const result=evaluate({
    patchApplied:true,sandboxPassed:true,testsPassed:true,
    ciPassed:true,ciVerified:false,filesChanged:["a.js"],
    attempts:1,maxAttempts:3,maxFilesChanged:10,runtimeSeconds:1,maxRuntimeSeconds:900
  });
  assert.notEqual(result.decision,"recovered");
  assert.equal(result.reason,"ci_not_independently_verified");
});
