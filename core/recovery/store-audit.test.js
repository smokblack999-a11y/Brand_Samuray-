"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs"),os=require("os"),path=require("path");
test("audit events form a verifiable hash chain",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"x20-audit-"));
 process.env.RECOVERY_DATA_DIR=dir;
 const store=require("./store");
 const j=store.createJob({id:"audit-test",source:{repo:"o/r",runId:"1",sha:"abc"}});
 store.updateJob(j.id,{status:"running"});
 const events=store.listEvents(j.id);
 assert.equal(events.length,2);
 assert.equal(events[1].prevHash,events[0].eventHash);
 assert.equal(events[0].eventHash.length,64);
 fs.rmSync(dir,{recursive:true,force:true});
});
