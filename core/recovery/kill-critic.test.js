"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluate}=require("./kill-critic");

test("sandbox failure is retryable before CI verification",()=>{
  const r=evaluate({patchApplied:true,sandboxPassed:false,testsPassed:false,ciPassed:false,ciVerified:false,attempts:1,maxAttempts:3});
  assert.equal(r.decision,"retryable");
  assert.equal(r.reason,"sandbox_failed");
});

test("test failure is retryable after sandbox passes",()=>{
  const r=evaluate({patchApplied:true,sandboxPassed:true,testsPassed:false,ciPassed:false,ciVerified:false,attempts:1,maxAttempts:3});
  assert.equal(r.decision,"retryable");
  assert.equal(r.reason,"tests_failed");
});

test("missing independent CI remains human review",()=>{
  const r=evaluate({patchApplied:true,sandboxPassed:true,testsPassed:true,ciPassed:false,ciVerified:false,attempts:1,maxAttempts:3});
  assert.equal(r.decision,"human_review");
  assert.equal(r.reason,"ci_not_independently_verified");
});

test("recovery requires all four gates",()=>{
  const r=evaluate({patchApplied:true,sandboxPassed:true,testsPassed:true,ciPassed:true,ciVerified:true,attempts:1,maxAttempts:3});
  assert.equal(r.decision,"recovered");
});
