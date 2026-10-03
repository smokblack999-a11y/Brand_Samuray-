"use strict";
const ledger=require("./revenue-ledger");
const {chooseNextAction}=require("./revenue-engine");
const {normalizeOutcome,evaluateAttribution}=require("./x27-outcome-engine");
const {buildLearningRecord}=require("./x27-attribution-engine");
const {buildActionStats}=require("./probability-calibrator");
function tenant(id){const v=String(id||"").trim();if(!v)throw new Error("tenantId is required");return v.slice(0,128);}
function historicalStats(t){return buildActionStats(ledger.list(t,"LEARNING"));}
function decide(tenantId,input){const t=tenant(tenantId);const d=chooseNextAction(Object.assign({},input||{},{historicalStats:historicalStats(t)}));d.tenantId=t;return ledger.appendDecision(d);}
function recordOutcome(tenantId,input){const t=tenant(tenantId);const safe=Object.assign({},input||{},{tenantId:t,eventId:String((input&&input.eventId)||"").trim()});const o=normalizeOutcome(safe);if(!o.eventId)throw new Error("eventId is required");const saved=ledger.appendOutcome(o);if(!saved.inserted)return {inserted:false,outcome:saved.record,attribution:null,learning:null};let decision=null;if(o.actionId)decision=ledger.list(t,"DECISION").find(x=>x.decisionId===o.actionId)||null;const baseline=Number(input&&input.baselineConversionProbability!=null?input.baselineConversionProbability:(decision&&decision.baselineConversionProbability)||0);const attribution=evaluateAttribution(o,baseline,input&&input.attributionPolicy||"ASSISTED");let learning=null;if(decision){learning=buildLearningRecord(decision,Object.assign({},attribution,{status:o.status}),Number(input&&input.actualCostKZT||0));learning=Object.assign({},learning,{tenantId:t});learning=ledger.appendLearning(learning).record;}return {inserted:true,outcome:saved.record,attribution,learning};}
function summary(tenantId){return ledger.summary(tenant(tenantId));}
function list(tenantId,type){return ledger.list(tenant(tenantId),type);}
module.exports={tenant,decide,recordOutcome,summary,list,historicalStats};
