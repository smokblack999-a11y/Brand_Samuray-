"use strict";
const crypto=require("crypto");
const {spawn}=require("child_process");
function patchHash(diff){return crypto.createHash("sha256").update(String(diff||"")).digest("hex");}
async function run({runId,command,args=[],cwd,timeoutMs=120000,env={},executor}={}){
  const id=runId||"run_"+crypto.randomUUID().replace(/-/g,"");
  if(typeof executor==="function") return executor({run_id:id,command,args,cwd,timeout_ms:timeoutMs});
  if(!command) return {run_id:id,status:"REJECTED",reason:"sandbox_command_missing",exit_code:null};
  if(!Array.isArray(args)||args.some(x=>typeof x!=="string")) return {run_id:id,status:"REJECTED",reason:"invalid_command_args",exit_code:null};
  return await new Promise(resolve=>{
    const started=Date.now(); const child=spawn(command,args,{cwd,env:{...process.env,...env},shell:false,stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",timedOut=false; const cap=65536;
    child.stdout.on("data",b=>{stdout=(stdout+String(b)).slice(-cap);});
    child.stderr.on("data",b=>{stderr=(stderr+String(b)).slice(-cap);});
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},timeoutMs);
    child.on("error",err=>{clearTimeout(timer);resolve({run_id:id,status:"FAILED",reason:err.code||err.message,exit_code:null,timed_out:timedOut,duration_ms:Date.now()-started,stdout,stderr});});
    child.on("close",code=>{clearTimeout(timer);resolve({run_id:id,status:code===0&&!timedOut?"PASSED":"FAILED",exit_code:code,timed_out:timedOut,duration_ms:Date.now()-started,stdout,stderr});});
  });
}
module.exports={run,patchHash};
