"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");

test("X20 golden path closes only on exact successful recovery SHA",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"x20-store-test-"));
  process.env.RECOVERY_DATA_DIR=dir;
  const recovery=require("./index");

  const job=recovery.enqueueFromGithub({
    repository:{full_name:"test/repo"},
    workflow_run:{id:77,name:"CI",conclusion:"failure",head_sha:"source-sha",head_branch:"main"}
  }).job;

  recovery.updateJob(job.id,{
    recovery:{branch:"x10think/recovery-test-a1",commitSha:"recovery-sha",treeSha:"tree"},
    verification:{
      patchApplied:true,sandboxPassed:true,testsPassed:true,ciPassed:false,ciVerified:false,
      regressionDetected:false,filesChanged:["src/fix.js"],runtimeSeconds:5
    }
  });

  const wrong=recovery.updateRecoveryCi({
    repository:{full_name:"test/repo"},
    workflow_run:{id:78,name:"CI",conclusion:"success",head_sha:"wrong-sha",head_branch:"x10think/recovery-test-a1"}
  });
  assert.equal(wrong.updated,false);

  const wrongBranch=recovery.updateRecoveryCi({
    repository:{full_name:"test/repo"},
    workflow_run:{id:80,name:"CI",conclusion:"success",head_sha:"recovery-sha",head_branch:"main"}
  });
  assert.equal(wrongBranch.updated,false);

  const good=recovery.updateRecoveryCi({
    repository:{full_name:"test/repo"},
    workflow_run:{id:79,name:"CI",conclusion:"success",head_sha:"recovery-sha",head_branch:"x10think/recovery-test-a1"}
  });
  assert.equal(good.updated,true);
  assert.equal(good.job.status,"recovered");
  assert.equal(good.job.verification.ciPassed,true);
  assert.equal(good.job.verification.ci.sha,"recovery-sha");
  assert.ok(good.job.proof);

  fs.rmSync(dir,{recursive:true,force:true});
});


test("GitHub delivery is idempotent for the same workflow run",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"x20-dedupe-test-"));
  process.env.RECOVERY_DATA_DIR=dir;
  const recovery=require("./index");
  const payload={
    repository:{full_name:"test/repo"},
    workflow_run:{id:91,name:"CI",conclusion:"failure",head_sha:"source-sha",head_branch:"main"}
  };
  const first=recovery.enqueueFromGithub(payload,[], "delivery-91");
  const second=recovery.enqueueFromGithub(payload,[], "delivery-91-retry");
  assert.equal(first.queued,true);
  assert.equal(first.duplicate,false);
  assert.equal(second.queued,false);
  assert.equal(second.duplicate,true);
  assert.equal(second.job.id,first.job.id);
  fs.rmSync(dir,{recursive:true,force:true});
});
