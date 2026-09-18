"use strict";

const path=require("path");
const fs=require("fs");

function assertSafeRelativeFile(file){
  if(typeof file!=="string"||!file||path.isAbsolute(file)||file.includes("\0")) throw new Error("unsafe patch path");
  const normalized=path.posix.normalize(file.replaceAll("\\","/"));
  if(normalized===".."||normalized.startsWith("../")||normalized.includes("/../")) throw new Error("path traversal rejected");
  if(normalized.startsWith(".git/")||normalized===".git") throw new Error("git metadata modification rejected");
  return normalized;
}

function validatePatch(patch={},budget={}){
  const files=Array.isArray(patch.files)?patch.files:[];
  const max=Number(budget.maxFilesChanged||10);
  if(files.length===0) throw new Error("patch must contain files");
  if(files.length>max) throw new Error("patch exceeds maxFilesChanged");
  return files.map(f=>({
    path:assertSafeRelativeFile(f.path),
    content:String(f.content??""),
    mode:f.mode||"100644"
  }));
}

function applyPatch(workspace,patch,budget={}){
  if(!workspace||!path.isAbsolute(workspace)) throw new Error("workspace must be absolute");
  if(!fs.existsSync(workspace)) throw new Error("workspace does not exist");
  const files=validatePatch(patch,budget);
  for(const file of files){
    const target=path.join(workspace,file.path);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,file.content,"utf8");
  }
  return {ok:true,filesChanged:files.map(f=>f.path)};
}

module.exports={assertSafeRelativeFile,validatePatch,applyPatch};
