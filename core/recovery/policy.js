"use strict";
const BLOCKED=[".github/workflows/","Dockerfile","docker-compose","k8s/","helm/","terraform/","pulumi/"];
const SENSITIVE=/\b(auth|oauth|jwt|credential|secret|token|private.?key|crypto|password|permission)\b/i;
function evaluatePatch(files=[],opts={}){
 const max=Number(opts.maxFilesChanged||10); const paths=files.map(f=>String(f.path||""));
 if(!files.length) return {allow:false,decision:"human_review",reason:"empty_patch"};
 if(files.length>max) return {allow:false,decision:"human_review",reason:"too_many_files"};
 for(const p of paths){
   if(!p||p.startsWith("/")||p.includes("..")||p.startsWith(".git/")) return {allow:false,decision:"blocked",reason:"unsafe_path"};
   if(BLOCKED.some(x=>p===x||p.startsWith(x))) return {allow:false,decision:"human_review",reason:"privileged_path"};
   if(SENSITIVE.test(p)) return {allow:false,decision:"human_review",reason:"sensitive_path"};
 }
 for(const f of files){
   const c=String(f.content||"");
   if(/rm\s+-rf\s+\/|curl\s+[^\n|]*\|\s*(sh|bash)|chmod\s+777|eval\s*\(/i.test(c))
     return {allow:false,decision:"blocked",reason:"dangerous_operation"};
 }
 return {allow:true,decision:"allow",reason:"policy_passed"};
}
module.exports={evaluatePatch,BLOCKED};
