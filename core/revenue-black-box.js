"use strict";
const crypto=require("node:crypto");

function hashPacket(packet,previousHash){ return crypto.createHash("sha256").update(String(previousHash||"")+"\n"+JSON.stringify(packet)).digest("hex"); }
function sealEvidencePacket(packet,previousHash){ const clean=buildEvidencePacket(packet); return Object.assign({},clean,{previousHash:previousHash||null,recordHash:hashPacket(clean,previousHash)}); }
function verifyEvidenceChain(records){ let previous=null; for(const r of Array.isArray(records)?records:[]){ const clean=Object.assign({},r); delete clean.recordHash; delete clean.previousHash; if((r.previousHash||null)!==(previous||null)||r.recordHash!==hashPacket(clean,r.previousHash)) return {ok:false,failedRecordId:r.decisionId||null}; previous=r.recordHash; } return {ok:true,records:Array.isArray(records)?records.length:0,lastHash:previous}; }

function buildEvidencePacket(input){
  return {tenantId:String(input.tenantId||""),decisionId:String(input.decisionId||""),action:String(input.action||""),expectedIncrementalProfitKZT:Number(input.expectedIncrementalProfitKZT||0),outcome:String(input.outcome||"UNKNOWN"),actualAttributableGrossProfitKZT:Number(input.actualAttributableGrossProfitKZT||0),actualCostKZT:Number(input.actualCostKZT||0),evidence:Array.isArray(input.evidence)?input.evidence.slice(0,50):[],createdAt:input.createdAt||new Date().toISOString()};
}

module.exports={buildEvidencePacket,hashPacket,sealEvidencePacket,verifyEvidenceChain};
