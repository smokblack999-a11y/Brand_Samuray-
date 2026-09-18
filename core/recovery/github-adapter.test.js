"use strict";
const assert=require("assert");
const {recoveryBranchName}=require("./github-adapter");

assert.strictEqual(recoveryBranchName("rec_test_123",2),"x10think/recovery-rec_test_123-a2");
assert.ok(!recoveryBranchName("../secret",1).includes(".."));
assert.ok(recoveryBranchName("rec/unsafe",1).startsWith("x10think/recovery-"));
console.log("github-adapter tests: PASS");
