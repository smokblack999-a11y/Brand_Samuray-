"use strict";
const recovery=require("./index");
const {applyPatch}=require("./patch-executor");
const {createSandbox,verifyWorkspace}=require("./sandbox");

async function processJob(id,executor){
  let job=recovery.startJob(id);
  const started=Date.now();
  try{
    job=recovery.diagnoseJob(id);
    const result=await executor(job);
    recovery.recordAction(id,{type:"recovery_execution",result:{
      ok:Boolean(result?.ok),
      code:result?.code??null,
      timedOut:Boolean(result?.timedOut),
      hypothesis:result?.hypothesis??null,
      filesChanged:Array.isArray(result?.filesChanged)?result.filesChanged:[]
    }});
    const verification={
      patchApplied:result?.patchApplied===true,
      sandboxPassed:result?.sandboxPassed===true,
      testsPassed:result?.testsPassed===true,
      ciPassed:result?.ciPassed===true,
      regressionDetected:result?.regressionDetected===true,
      filesChanged:Array.isArray(result?.filesChanged)?result.filesChanged:[],
      runtimeSeconds:Math.ceil((Date.now()-started)/1000)
    };
    if(verification.runtimeSeconds>job.budget.maxRuntimeSeconds)
      return recovery.updateJob(id,{status:"frozen",lastDecision:{decision:"frozen",reason:"recovery_budget_exceeded"}});
    return {job:recovery.gate(id,verification),verification};
  }catch(error){
    return recovery.updateJob(id,{status:"retryable",lastError:String(error?.message||error)});
  }
}
module.exports={processJob};
