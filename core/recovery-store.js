"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const { transition }=require("./x10thinc/recovery-state");
const { append: audit }=require("./recovery-audit");

const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,"data");
const FILE=path.join(DATA_DIR,"recovery-jobs.json");
const LOCK=`${FILE}.lock`;
const LOCK_TTL_MS=30000;

function ensure(){fs.mkdirSync(DATA_DIR,{recursive:true});if(!fs.existsSync(FILE))fs.writeFileSync(FILE,"[]\n");}
function withLock(fn){
  ensure();const started=Date.now();
  while(true){
    try{const fd=fs.openSync(LOCK,"wx");try{return fn();}finally{fs.closeSync(fd);fs.rmSync(LOCK,{force:true});}}
    catch(error){
      if(error.code!=="EEXIST")throw error;
      try{const stat=fs.statSync(LOCK);if(Date.now()-stat.mtimeMs>LOCK_TTL_MS)fs.rmSync(LOCK,{force:true});}catch{}
      if(Date.now()-started>LOCK_TTL_MS)throw new Error("RECOVERY_STORE_LOCK_TIMEOUT");
    }
  }
}
function read(){ensure();return JSON.parse(fs.readFileSync(FILE,"utf8"));}
function write(rows){
  ensure();const tmp=`${FILE}.${process.pid}.tmp`;
  const fd=fs.openSync(tmp,"w",0o600);
  try{fs.writeFileSync(fd,JSON.stringify(rows,null,2)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,FILE);
}
function eventKeyFor(run){return `github:workflow_run:${run.repository||"unknown"}:${run.runId||run.runNumber||"unknown"}`;}
function enqueue(input={}){
  if(!input.repository||(!input.runId&&!input.runNumber))throw new Error("repository and workflow_run.id are required");
  return withLock(()=>{
    const rows=read(),eventKey=input.eventKey||eventKeyFor(input),existing=rows.find(x=>x.eventKey===eventKey);
    if(existing)return{created:false,job:existing};
    const id=`recovery-${crypto.createHash("sha256").update(eventKey).digest("hex").slice(0,24)}`,now=new Date().toISOString();
    const job={id,eventKey,createdAt:now,updatedAt:now,state:"queued",status:"queued",attempts:0,
      maxAttempts:Math.max(1,Number(input.maxAttempts||process.env.RECOVERY_MAX_ATTEMPTS||3)),
      repository:String(input.repository),workflow:input.workflow||null,runId:String(input.runId||input.runNumber),
      runNumber:input.runNumber||null,branch:input.branch||null,headSha:input.sha||null,
      failureLogs:String(input.failureLogs||"").slice(-12000),diagnosis:input.diagnosis||null,patch:null,proofReceipt:null};
    rows.push(job);write(rows);audit("recovery.job.enqueued",{jobId:id,eventKey,repository:job.repository,runId:job.runId});
    return{created:true,job};
  });
}
function find(id){return read().find(x=>x.id===id)||null;}
function list(limit=100){return read().slice(-Math.min(Math.max(Number(limit)||100,1),1000)).reverse();}
function update(id,patch){
  return withLock(()=>{
    const rows=read(),i=rows.findIndex(x=>x.id===id);if(i<0)throw new Error("recovery job not found");
    const current=rows[i];
    if(patch&&Object.prototype.hasOwnProperty.call(patch,"state")&&String(patch.state)!==String(current.state)){
      const checked=transition(current,patch.state,{proof:patch.proof||{}});if(!checked.ok)throw new Error(checked.code);
    }
    const next={...current,...patch,updatedAt:new Date().toISOString()};rows[i]=next;write(rows);
    audit("recovery.job.updated",{jobId:id,fromState:current.state,toState:next.state,status:next.status,attempts:next.attempts});
    return next;
  });
}
module.exports={enqueue,find,list,update,eventKeyFor};
