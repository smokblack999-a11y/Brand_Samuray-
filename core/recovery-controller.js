"use strict";
const { list, update } = require("./recovery-store");
const { generatePatchCandidate } = require("./recovery-proposer");
const { buildPatchCandidate } = require("./interop/patch-candidate");
const { tick } = require("./recovery-worker");
const MAX_STEPS=3;
async function runOnce(){
 const job=list(1000).find(x=>["queued","ready_for_patch"].includes(x.status));
 if(!job){await tick();return{stage:"idle",processed:false,reason:"no_actionable_job"};}
 if(!job.failureLogs){update(job.id,{status:"stopped",controllerError:"FAILURE_EVIDENCE_MISSING"});return{stage:"evidence",processed:true,jobId:job.id,action:"STOP"};}
 try{
  const candidate=await generatePatchCandidate({repoDir:process.env.RECOVERY_REPO_DIR,sourceRef:job.sha,failureLogs:job.failureLogs,diagnosis:job.diagnosis,fingerprint:job.fingerprint});
  if(!candidate.accepted){update(job.id,{status:"human_review",controllerError:candidate.reason});return{stage:"x10think",processed:true,jobId:job.id,action:"HUMAN_REVIEW",reason:candidate.reason};}
  const checked=buildPatchCandidate({evidenceFingerprint:job.fingerprint,diff:candidate.candidate.diff,source:"x10think"});
  if(!checked.accepted){update(job.id,{status:"stopped",controllerError:checked.reason});return{stage:"kill_critic",processed:true,jobId:job.id,action:"STOP",reason:checked.reason};}
  update(job.id,{status:"sandbox_pending",patchCandidate:{...candidate.candidate,source:"x10think"},patch:{changedFiles:checked.candidate.files.length,changedLines:String(checked.candidate.diff).split(/\r?\n/).filter(line=>/^\+[^+]|^-[^-]/.test(line)).length}});
  await tick();
  return{stage:"sandbox",processed:true,jobId:job.id,action:"SANDBOX"};
 }catch(error){update(job.id,{status:"stopped",controllerError:String(error?.message||error)});return{stage:"x10think",processed:true,jobId:job.id,action:"STOP",reason:String(error?.message||error)};}
}
async function runBounded(maxSteps=MAX_STEPS){const limit=Math.max(1,Math.min(Number(maxSteps)||MAX_STEPS,MAX_STEPS));const steps=[];for(let i=0;i<limit;i++){const result=await runOnce();steps.push(result);if(!result.processed)break;}return{ok:true,steps};}
async function startDaemon() {
  const pollMs = Math.max(1000, Number(process.env.RECOVERY_CONTROLLER_POLL_MS || 5000));
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try { await runBounded(); } catch (error) { console.error(JSON.stringify({ok:false,error:error.message})); }
    finally { busy = false; }
  };
  await loop();
  return setInterval(loop, pollMs);
}

if(require.main===module){
  if(String(process.env.RECOVERY_CONTROLLER_DAEMON || "").toLowerCase()==="true"){
    startDaemon();
  } else {
    runBounded().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});
  }
}
module.exports={runOnce,runBounded,startDaemon};
