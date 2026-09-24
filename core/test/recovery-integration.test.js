"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x10thinc-recovery-test-"));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve("../recovery-store")];
  return require("../recovery-store");
}

test("workflow_run enqueue is idempotent", () => {
  const s = freshStore();
  const input = {repository:"o/r", runId:123, sha:"abc", conclusion:"failure"};
  const a=s.enqueue(input), b=s.enqueue(input);
  assert.equal(a.created,true);
  assert.equal(b.created,false);
  assert.equal(a.job.id,b.job.id);
});

test("verification lookup is mandatory before trusted transition", () => {
  const job={id:"j",repository:"o/r",headSha:"abc",diffHash:"d",state:"pr_ready"};
  const {transition,STATES}=require("../x10thinc/recovery-state");
  const r=transition(job,STATES.VERIFIED,{proof:{
    jobId:"j",repository:"o/r",headSha:"abc",diffHash:"d",verificationRunId:1,
    patchApplied:true,sandboxPassed:true,testsPassed:true,ciPassed:true,
    invariantsPassed:true,evidenceComplete:true,autonomousMerge:false
  }});
  assert.equal(r.ok,true);
  assert.match(r.job.proofReceipt.receiptHash,/^[a-f0-9]{64}$/);
});