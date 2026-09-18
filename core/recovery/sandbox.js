"use strict";
const fs=require("fs"),os=require("os"),path=require("path"),{spawn}=require("child_process");
function runProcess(command,args=[],options={}){
 const cwd=options.cwd||process.cwd(), timeoutMs=Math.min(Number(options.timeoutMs||120000),300000);
 return new Promise(resolve=>{const child=spawn(command,args,{cwd,env:{...process.env,...(options.env||{})},shell:false});let stdout="",stderr="",timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},timeoutMs);
 child.stdout.on("data",d=>stdout+=d.toString());child.stderr.on("data",d=>stderr+=d.toString());
 child.on("close",code=>{clearTimeout(timer);resolve({ok:!timedOut&&code===0,code,timedOut,stdout:stdout.slice(-12000),stderr:stderr.slice(-12000)})})});
}
async function verifyWorkspace(workspace,options={}){
 if(!workspace||!path.isAbsolute(workspace))throw new Error("sandbox workspace must be absolute");
 if(!fs.existsSync(workspace))throw new Error("sandbox workspace does not exist");
 const s=options.sandboxOptions||{};
 if((s.runtime||"process")==="docker"){
   const image=String(s.image||"node:22-bookworm-slim");
   const args=["run","--rm","--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--memory",String(s.memory||"1g"),"--cpus",String(s.cpus||"1"),"--pids-limit",String(s.pidsLimit||128),"-v",workspace+":/workspace:rw","-w","/workspace",image,options.command||"npm",...(options.args||["test"])];
   return runProcess("docker",args,{timeoutMs:options.timeoutMs});
 }
 return runProcess(options.command||"npm",options.args||["test"],{cwd:workspace,timeoutMs:options.timeoutMs});
}
async function createSandbox(sourceDir){
 if(!sourceDir||!path.isAbsolute(sourceDir))throw new Error("sourceDir must be absolute");
 const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),"x10think-sandbox-"));
 fs.cpSync(sourceDir,sandbox,{recursive:true,filter:(src)=>!src.includes("/.git/")});
 return sandbox;
}
function cleanupSandbox(workspace){
 if(!workspace||!path.isAbsolute(workspace)) return false;
 const root=path.resolve(os.tmpdir());
 const target=path.resolve(workspace);
 const rel=path.relative(root,target);
 if(!rel||rel.startsWith(".."+path.sep)||path.isAbsolute(rel)||!rel.startsWith("x10think-sandbox-")) return false;
 fs.rmSync(target,{recursive:true,force:true});
 return true;
}
module.exports={runProcess,verifyWorkspace,createSandbox,cleanupSandbox};
