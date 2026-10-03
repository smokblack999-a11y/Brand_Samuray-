"use strict";
const ledger=require("./revenue-ledger");
const {chooseNextAction}=require("./revenue-engine");
const {normalizeOutcome,evaluateAttribution}=require("./x27-outcome-engine");
const {buildLearningRecord}=require("./x27-attribution-engine");
const {buildActionStats}=require("./probability-calibrator");
const {constrainDecision}=require("./budget-governor");
function tenant(id){const v=String(id||"").trim();if(!v)throw new Error("tenantId is required");return v.slice(0,128);}
function historicalStats(t){return buildActionStats(ledger.list(t,"LEARNING"));}
function decide(tenantId,input){const t=tenant(tenantId);const d=chooseNextAction(Object.assign({},input||{},{historicalStats:historicalStats(t)}));d.tenantId=t;return ledger.appendDecision(d);}
function recordOutcome(tenantId,input){
  const t=tenant(tenantId); const raw=Object.assign({},input||{}); const eventId=String(raw.eventId||\"\").trim(); if(!eventId) throw new Error(\"eventId is required\");
  let decision=null; if(raw.actionId) decision=ledger.list(t,\"DECISION\").find(x=>x.decisionId===raw.actionId)||null;
  const safe=Object.assign({},raw,{tenantId:t,eventId});
  if(safe.grossMarginRate==null && decision && decision.grossMargin!=null) safe.grossMarginRate=decision.grossMargin;
  const o=normalizeOutcome(safe);
  const baseline=Number(raw.baselineConversionProbability!=null?raw.baselineConversionProbability:(decision&&decision.baselineConversionProbability)||0);
  const attribution=evaluateAttribution(o,baseline,raw.attributionPolicy||\"ASSISTED\");
  const storedOutcome=Object.assign({},o,attribution);
  const saved=ledger.appendOutcome(storedOutcome); if(!saved.inserted) return {inserted:false,outcome:saved.record,attribution:null,learning:null};
  let costRecord=null; if(Number(raw.actualCostKZT||0)>0){ costRecord=ledger.appendCost({tenantId:t,costId:String(raw.costId||o.eventId+":execution"),decisionId:o.actionId||null,provider:raw.provider||null,model:raw.model||null,amountKZT:Number(raw.actualCostKZT||0),inputTokens:Number(raw.inputTokens||0),outputTokens:Number(raw.outputTokens||0),currency:raw.currency||"KZT"}).record; }
  let learning=null;
  if(decision){ learning=Object.assign({},buildLearningRecord(Object.assign({},decision,{expectedIncrementalProfit:decision.expectedIncrementalProfit!=null?decision.expectedIncrementalProfit:decision.expectedValue}),Object.assign({},attribution,{status:o.status,sourceEventId:o.eventId}),Number(raw.actualCostKZT||0)),{tenantId:t}); learning=ledger.appendLearning(learning).record; }
  return {inserted:true,outcome:saved.record,attribution,learning,cost:costRecord};
}
function summary(tenantId){return ledger.summary(tenant(tenantId));}
function list(tenantId,type){return ledger.list(tenant(tenantId),type);}
function integrity(tenantId){return ledger.integrity(tenant(tenantId));}
module.exports={tenant,decide,recordOutcome,summary,list,integrity,historicalStats,monthlyCostKZT};
