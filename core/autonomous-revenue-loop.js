"use strict";
const crypto=require("node:crypto");
const STATES=["DISCOVERED","AUDITED","DECISIONED","EXECUTED","OUTCOME_PENDING","ATTRIBUTED","LEARNED","EXPANDED","SUPPRESSED","FAILED"];
const EDGES={DISCOVERED:["AUDITED","SUPPRESSED","FAILED"],AUDITED:["DECISIONED","SUPPRESSED","FAILED"],DECISIONED:["EXECUTED","SUPPRESSED","FAILED"],EXECUTED:["OUTCOME_PENDING","FAILED"],OUTCOME_PENDING:["ATTRIBUTED","FAILED"],ATTRIBUTED:["LEARNED","FAILED"],LEARNED:["EXPANDED","SUPPRESSED"],EXPANDED:[],SUPPRESSED:[],FAILED:[]};
function fingerprint(input){return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");}
function createLoop(input={}){if(!input.tenantId)throw new Error("tenantId_required");if(!input.leadId)throw new Error("leadId_required");return {loopId:input.loopId||crypto.randomUUID(),tenantId:String(input.tenantId),leadId:String(input.leadId),state:"DISCOVERED",createdAt:new Date().toISOString(),fingerprint:fingerprint(input)};}
function transition(loop,next,evidence={}){if(!loop||!EDGES[loop.state]||!EDGES[loop.state].includes(next))throw new Error("invalid_loop_transition:"+(loop&&loop.state)+"->"+next);return Object.assign({},loop,{state:next,evidence:Object.assign({},loop.evidence||{},evidence),transitionHash:fingerprint({loopId:loop.loopId,from:loop.state,to:next,evidence})});}
function closeFromOutcome(loop,outcome){if(outcome&&String(outcome.status).toUpperCase()==="WON")return transition(loop,"ATTRIBUTED",{outcomeStatus:"WON"});if(outcome&&["LOST","REFUNDED","CANCELLED"].includes(String(outcome.status).toUpperCase()))return transition(loop,"LEARNED",{outcomeStatus:String(outcome.status).toUpperCase()});return transition(loop,"OUTCOME_PENDING",{outcomeStatus:"UNKNOWN"});}
module.exports={STATES,EDGES,createLoop,transition,closeFromOutcome};
