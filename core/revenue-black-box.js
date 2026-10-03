"use strict";

function buildEvidencePacket(input){
  return {tenantId:String(input.tenantId||""),decisionId:String(input.decisionId||""),action:String(input.action||""),expectedIncrementalProfitKZT:Number(input.expectedIncrementalProfitKZT||0),outcome:String(input.outcome||"UNKNOWN"),actualAttributableGrossProfitKZT:Number(input.actualAttributableGrossProfitKZT||0),actualCostKZT:Number(input.actualCostKZT||0),evidence:Array.isArray(input.evidence)?input.evidence.slice(0,50):[],createdAt:input.createdAt||new Date().toISOString()};
}

module.exports={buildEvidencePacket};
