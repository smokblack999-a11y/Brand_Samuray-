"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,"data");
const FILE=path.join(DATA_DIR,"recovery-audit.jsonl");
const REDACTED="[REDACTED]";

function redact(v){
  return String(v??"")
    .replace(/(authorization|api[-_ ]?key|token|secret|password|cookie)\s*[:=]\s*[^\s,;]+/gi,"$1:"+REDACTED)
    .replace(/sk-(?:proj|svcacct)-[A-Za-z0-9_-]+/g,REDACTED);
}
function hash(value){return crypto.createHash("sha256").update(String(value),"utf8").digest("hex");}
function lastHash(){
  try{
    const lines=fs.readFileSync(FILE,"utf8").trim().split(/\r?\n/).filter(Boolean);
    if(!lines.length)return "GENESIS";
    return String(JSON.parse(lines[lines.length-1]).recordHash||"GENESIS");
  }catch{return "GENESIS";}
}
function append(event,data={}){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  const record={ts:new Date().toISOString(),event:String(event),prevHash:lastHash(),data:JSON.parse(redact(JSON.stringify(data)))};
  record.recordHash=hash(JSON.stringify(record));
  fs.appendFileSync(FILE,JSON.stringify(record)+"\n",{mode:0o600});
  return record;
}
function verifyChain(){
  try{
    if(!fs.existsSync(FILE))return {passed:true,records:0};
    const lines=fs.readFileSync(FILE,"utf8").trim().split(/\r?\n/).filter(Boolean);
    let previous="GENESIS";
    for(let i=0;i<lines.length;i++){
      const record=JSON.parse(lines[i]);
      if(record.prevHash!==previous)return {passed:false,index:i,reason:"AUDIT_PREV_HASH_MISMATCH"};
      const supplied=record.recordHash;
      const copy={...record}; delete copy.recordHash;
      if(hash(JSON.stringify(copy))!==supplied)return {passed:false,index:i,reason:"AUDIT_RECORD_HASH_MISMATCH"};
      previous=supplied;
    }
    return {passed:true,records:lines.length,lastHash:previous};
  }catch(error){return {passed:false,reason:"AUDIT_CHAIN_INVALID",message:error.message};}
}
function hashRecord(record){return hash(JSON.stringify(record));}
module.exports={append,hashRecord,verifyChain,FILE};
