"use strict";
const assert=require("assert");
const {createGitHubAdapter,recoveryBranchName}=require("./github-adapter");

assert.strictEqual(recoveryBranchName("rec_test_123",2),"x10think/recovery-rec_test_123-a2");
assert.ok(!recoveryBranchName("../secret",1).includes(".."));

assert.throws(()=>createGitHubAdapter({}),/GitHub token is required/);
const adapter=createGitHubAdapter({token:"test-token",apiBase:"https://example.invalid"});
assert.strictEqual(typeof adapter.createBranch,"function");
assert.strictEqual(typeof adapter.applyPatchAndCreateCommit,"function");
assert.strictEqual(typeof adapter.createPullRequest,"function");

console.log("github-adapter tests: PASS");
