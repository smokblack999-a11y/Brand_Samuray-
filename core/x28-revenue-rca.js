"use strict";

function num(value, fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(v,min=0,max=1){return Math.max(min,Math.min(max,num(v)));}
function minutesBetween(a,b){const x=Date.parse(String(a||"")),y=Date.parse(String(b||""));if(!Number.isFinite(x)||!Number.isFinite(y)||y<x)return null;return Math.round((y-x)/60000);}
function classifyEvent(ev){const type=String(ev?.type||"").toLowerCase();const p=ev?.payload||{};return {type,text:String(p.text||ev?.text||""),ts:ev?.ts||p.ts||null,intent:String(p.intent||"").toLowerCase(),actor:String(p.actor||type)};}
function analyzeLeadLoss(events=[],input={}){
  const normalized=(Array.isArray(events)?events:[]).map(classifyEvent).sort((a,b)=>Date.parse(a.ts||0)-Date.parse(b.ts||0));
  const customer=normalized.filter(e=>e.type.includes("customer")&&e.type.includes("message"));
  const responses=normalized.filter(e=>e.type.includes("manager")||e.type.includes("agent")||e.type.includes("ai.response")||e.type==="ai.response");
  const objections=normalized.filter(e=>e.type.includes("customer")||e.type==="objection").filter(e=>["objection","price","budget","competitor","trust"].includes(e.intent)||/(дорог|цена|дорого|бюджет|конкурент|не довер|сомнева)/i.test(e.text));
  const firstCustomer=customer[0]||null;
  const firstResponse=responses[0]||null;
  const latencyMinutes=firstCustomer&&firstResponse?minutesBetween(firstCustomer.ts,firstResponse.ts):firstCustomer?minutesBetween(firstCustomer.ts,input.analyzedAt||new Date().toISOString()):null;
  const responseSlaMinutes=Math.max(1,num(input.responseSlaMinutes,15));
  const hasFollowup=normalized.some(e=>/follow.?up|reminder|followup/i.test(e.type)||e.intent==="follow_up");
  const answeredObjection=objections.length>0&&normalized.some(e=>responses.includes(e)&&Date.parse(e.ts||0)>Date.parse(objections[0].ts||0));
  const hypotheses=[];
  function add(code,evidence,confidence,action){hypotheses.push({code,evidence:evidence.slice(0,8),confidencePct:Math.round(Math.max(0,Math.min(99,confidence))),recommendedAction:action});}
  if(firstCustomer&&!firstResponse&&latencyMinutes!==null&&latencyMinutes>responseSlaMinutes)add("RESPONSE_DELAY",["No agent response observed within the SLA window."],Math.min(95,60+latencyMinutes/10),"ACTIVATE_SPEED_TO_LEAD");
  if(firstCustomer&&firstResponse&&latencyMinutes!==null&&latencyMinutes>responseSlaMinutes)add("RESPONSE_DELAY",["First response exceeded configured SLA: "+latencyMinutes+" minutes."],Math.min(92,55+latencyMinutes/12),"REDUCE_RESPONSE_LATENCY");
  if(objections.length&&!answeredObjection)add("UNHANDLED_OBJECTION",objections.map(e=>e.intent||e.text).filter(Boolean),86,"RUN_OBJECTION_PLAYBOOK");
  if(firstCustomer&&!hasFollowup&&responses.length>0)add("NO_FOLLOWUP",["A customer message was answered but no follow-up event was observed."],78,"TRIGGER_FOLLOWUP_SEQUENCE");
  if(objections.some(e=>e.intent==="price"||/дорог|цена|бюджет/i.test(e.text)))add("PRICE_FRICTION",objections.filter(e=>e.intent==="price"||/дорог|цена|бюджет/i.test(e.text)).map(e=>e.text||"price objection"),74,"RUN_VALUE_OR_SCOPE_REFRAME");
  if(objections.some(e=>e.intent==="trust"||/не довер|сомнева/i.test(e.text)))add("TRUST_FRICTION",objections.map(e=>e.text||"trust objection"),72,"PROVIDE_EVIDENCE_AND_HUMAN_ESCALATION");
  if(!hypotheses.length)add("UNKNOWN",["Available telemetry does not establish a strong failure pattern."],35,"COLLECT_MORE_TELEMETRY");
  const dealValue=Math.max(0,num(input.dealValue,0));
  const baseline=clamp(input.baselineConversionProbability!=null?input.baselineConversionProbability:0.10);
  const margin=clamp(input.grossMargin!=null?input.grossMargin:0.30);
  const expectedGrossProfitAtRisk=Math.round(dealValue*baseline*margin);
  hypotheses.sort((a,b)=>b.confidencePct-a.confidencePct);
  const primary=hypotheses[0];
  return {causalityStatus:"HYPOTHESIS_ONLY",primaryHypothesis:primary.code,confidencePct:primary.confidencePct,evidence:primary.evidence,alternatives:hypotheses.slice(1),latencyMinutes,responseSlaMinutes,dealValue,baselineConversionProbability:baseline,grossMargin:margin,expectedGrossProfitAtRiskKZT:expectedGrossProfitAtRisk,nextBestAction:primary.recommendedAction,telemetryQuality:{customerMessages:customer.length,agentResponses:responses.length,objectionSignals:objections.length,followupsObserved:hasFollowup}};
}
module.exports={analyzeLeadLoss,minutesBetween};
