"use strict";
const crypto=require("crypto");
function canonical(value){return JSON.stringify(value,(k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,key)=>(o[key]=v[key],o),{}):v);}
function createProofReceipt(job,verification={}) {
  const payload={version:"x20",recoveryId:job.id,source:job.source,recovery:job.recovery||null,verification,budget:job.budget,finalState:"recovered"};
  const canonicalJson=canonical(payload);
  return {...payload,canonicalSha256:crypto.createHash("sha256").update(canonicalJson).digest("hex"),generatedAt:new Date().toISOString()};
}
function verifyProofReceipt(receipt){
  if(!receipt?.canonicalSha256) return false;
  const copy={...receipt}; delete copy.canonicalSha256; delete copy.generatedAt;
  return crypto.createHash("sha256").update(canonical(copy)).digest("hex")===receipt.canonicalSha256;
}
module.exports={canonical,createProofReceipt,verifyProofReceipt};
