"use strict";
const ledger=require("./revenue-ledger");
const {chooseNextAction}=require("./revenue-engine");
const {normalizeOutcome,evaluateAttribution}=require("./x27-outcome-engine");
const {buildLearningRecord}=require("./x27-attribution-engine");
const {buildActionStats}=require("./probability-calibrator");
function tenant(id){const v=String(id||"").trim();if(!v)throw new Error("tenantId is required");return v.slice(0,128);}
function decide(tenantId,input){const t=tenant(tenantId);const history=buildActionStats(ledger.list(t,"LEARNING"));const d=chooseNextAction(Object.assign({},input||{},{historicalStats:history}));d.tenantId=t;return ledger.appendDecision(d);}
module.exports={tenant};
