"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRepairPullRequest, branchName } = require("./repair-pr");

test("repair PR requires verified reproduction and causality", async () => {
  await assert.rejects(
    () => createRepairPullRequest({ baseSha:"a".repeat(40), reproductionProof:{passed:false} }),
    /VERIFIED_REPRODUCTION_REQUIRED/
  );
});

test("repair branch is deterministic and bounded", () => {
  assert.match(branchName("job/123", "a".repeat(40)), /^samurai\/repair-/);
});

test("repair PR publishes final verified files without merge", async () => {
  const calls=[];
  const out=await createRepairPullRequest({
    repository:"smokblack999-a11y/Brand_Samuray-",
    baseSha:"a".repeat(40),
    baseBranch:"main",
    jobId:"job-123",
    patchCandidate:{diff:"--- a/core/fix.js\n+++ b/core/fix.js\n@@ -1 +1 @@\n-a\n+b\n"},
    reproductionProof:{passed:true,reproduction:true,causality:true},
    finalFiles:[{path:"core/fix.js",content:"b\n"}]
  },{
    createBranch: async x=>calls.push(["branch",x]),
    fetchFile: async x=>({result:{sha:"e".repeat(40)}}),
    updateFile: async x=>{calls.push(["update",x]); return {result:{commit_sha:"d".repeat(40)}}},
    createPullRequest: async x=>({result:{number:99,html_url:"https://github.com/example/pr/99"}})
  });
  assert.equal(out.commitShas[0],"d".repeat(40));
  assert.equal(out.pr.number,99);
  assert.equal(calls[0][1].sha,"a".repeat(40));
  assert.equal(out.autonomousMerge,false);
});
