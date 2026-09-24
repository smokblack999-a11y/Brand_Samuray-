"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,"data");
const FILE=path.join(DATA_DIR,"recovery-audit.jsonl");
function redact(v){
  return String(v??"").replace(/(authorization|api[-_ ]?key|token|secret|password|cookie)\s*[:=]\s*[^\s,;]+/gi,"$1:[REDACTED]")
    .replace(/sk-(?:proj|svcacct)-[A-Za-z0-9_-]+/g,"[REDACTED]");
}
function append(event,data={}){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  const record={ts:new Date().toISOString(),event,data:JSON.parse(redact(JSON.stringify(data)))};
  fs.appendFileSync(FILE,JSON.stringify(record)+"\n");
  return record;
}
function hashRecord(record){return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");}
module.exports={append,hashRecord,FILE};
