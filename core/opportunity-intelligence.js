"use strict";

const crypto = require("node:crypto");
const ledger = require("./revenue-ledger");

const clamp = (n, min=0, max=1) => Math.max(min, Math.min(max, Number(n) || 0));
const nowMs = () => Date.now();

function num(v, fallback=0) {
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function text(v, max=512) { return String(v == null ? "" : v).trim().slice(0,max); }
function recencyFactor(occurredAt, halfLifeHours=168) {
  const t=Date.parse(occurredAt || 0);
  if (!Number.isFinite(t) || t <= 0) return 0.5;
  const ageHours=Math.max(0,(nowMs()-t)/3600000);
  return Math.exp(-Math.log(2)*ageHours/Math.max(1,halfLifeHours));
}
function domainOf(value) {
  const raw=text(value,512).toLowerCase();
  if (!raw) return "";
  try { return new URL(raw.includes("://") ? raw : "https://"+raw).hostname.replace(/^www\./,""); }
  catch { return raw.replace(/^www\./,"").split("/")[0]; }
}
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0,24); }

function extractSignals(prospect={}) {
  const q=prospect.qualification || {};
  const l=prospect.lead || {};
  const d=prospect.decision || {};
  const signals=prospect.signals || prospect.observations || [];
  const joined=JSON.stringify({q,l,d,signals}).toLowerCase();

  const signal = (terms) => terms.some(t => joined.includes(t));
  const count = (terms) => terms.reduce((n,t)=>n+(joined.includes(t)?1:0),0);

  const fit = clamp(
    num(q.score)/100 * 0.65 +
    (signal(["saas","software","platform","api","cloud"]) ? 0.20 : 0) +
    (signal(["b2b","enterprise","business","teams"]) ? 0.15 : 0)
  );
  const pain = clamp(
    (signal(["sales","revenue","pipeline","crm","leads","revops","gtm"]) ? 0.45 : 0) +
    Math.min(0.35,count(["pricing","growth","hiring","sales","revenue","pipeline","crm"])*0.07) +
    num(q.score)/100*0.20
  );
  const buyer = clamp(
    (signal(["ceo","founder","cro","head of sales","head of revenue","revops","sales director"]) ? 0.65 : 0) +
    (l.email ? 0.25 : 0) +
    (l.name ? 0.10 : 0)
  );
  const intent = clamp(
    (signal(["pricing","demo","book a demo","contact sales","trial","growth","hiring","funding"]) ? 0.55 : 0) +
    num(q.intentScore || q.intent)/100*0.25 +
    num(q.score)/100*0.20
  );
  const contactability=clamp((l.email?0.65:0)+(l.linkedinUrl?0.15:0)+(l.name?0.10:0)+(l.company?0.10:0));
  const sourceQuality=prospect.source === "apollo" ? 0.90 : prospect.source?.startsWith("public") ? 0.65 : 0.50;
  const recency=recencyFactor(prospect.occurredAt || prospect.createdAt || prospect.observedAt);

  return { fit,pain,buyer,intent,contactability,sourceQuality,recency };
}

function probabilityFromSignals(s) {
  const raw =
    0.04 +
    s.fit*0.18 +
    s.pain*0.23 +
    s.buyer*0.18 +
    s.intent*0.20 +
    s.contactability*0.08 +
    s.sourceQuality*0.04 +
    s.recency*0.05;
  return clamp(raw);
}

function outcomeCalibration(tenantId) {
  const outcomes=ledger.list(tenantId,"OUTCOME");
  const relevant=outcomes.filter(x => x.correlationId || x.actionId);
  const won=relevant.filter(x=>x.status==="WON").length;
  return {
    samples: relevant.length,
    empiricalConversion: relevant.length ? won/relevant.length : null
  };
}

function scoreOpportunity(prospect={}, opts={}) {
  const tenantId=text(opts.tenantId || prospect.tenantId || "default",128);
  const s=extractSignals(prospect);
  let purchaseProbability=probabilityFromSignals(s);
  const calibration=outcomeCalibration(tenantId);
  if (calibration.samples >= 10) purchaseProbability=clamp(purchaseProbability*0.70+calibration.empiricalConversion*0.30);

  const revenueKZT=Math.max(0,num(
    prospect.expectedRevenueKZT ||
    prospect.dealValueKZT ||
    prospect.decision?.dealValueKZT ||
    opts.dealValueKZT || 200000
  ));
  const margin=clamp(
    prospect.grossMarginRate ?? prospect.decision?.grossMarginRate ?? opts.grossMarginRate ?? 0.30
  );
  const grossProfitKZT=revenueKZT*margin;
  const executionCostKZT=Math.max(0,num(
    prospect.expectedExecutionCostKZT ||
    prospect.actionCostKZT ||
    prospect.decision?.actionCost ||
    opts.defaultActionCostKZT || 1000
  ));
  const risk=clamp(
    num(prospect.risk) +
    (s.recency < 0.25 ? 0.15 : 0) +
    (s.contactability < 0.30 ? 0.15 : 0)
  );
  const expectedGrossProfitKZT=grossProfitKZT*purchaseProbability;
  const expectedNetProfitKZT=expectedGrossProfitKZT-executionCostKZT;
  const roiMultiple=executionCostKZT>0 ? expectedNetProfitKZT/executionCostKZT : null;
  const confidence=clamp(
    0.25 +
    s.sourceQuality*0.20 +
    s.recency*0.15 +
    Math.min(1, calibration.samples/20)*0.20 +
    (s.contactability+s.buyer+s.pain)/3*0.20
  );

  const opportunityId="opp_"+hash(tenantId+":"+domainOf(prospect.lead?.domain || prospect.lead?.companyDomain || prospect.lead?.company || prospect.lead?.email)+":"+text(prospect.lead?.email || prospect.id,256));
  const action = expectedNetProfitKZT > 0 && purchaseProbability >= (opts.minProbability ?? 0.35) && confidence >= (opts.minConfidence ?? 0.35)
    ? "INVEST"
    : "SKIP";

  return {
    opportunityId,
    tenantId,
    company: prospect.lead?.company || prospect.lead?.organizationName || "",
    domain: domainOf(prospect.lead?.domain || prospect.lead?.companyDomain || ""),
    signals: Object.fromEntries(Object.entries(s).map(([k,v])=>[k,Number(v.toFixed(4))])),
    purchaseProbability:Number(purchaseProbability.toFixed(4)),
    expectedRevenueKZT:Math.round(revenueKZT),
    expectedGrossProfitKZT:Math.round(expectedGrossProfitKZT),
    expectedExecutionCostKZT:Math.round(executionCostKZT),
    expectedNetProfitKZT:Math.round(expectedNetProfitKZT),
    roiMultiple:roiMultiple==null?null:Number(roiMultiple.toFixed(3)),
    risk:Number(risk.toFixed(4)),
    confidence:Number(confidence.toFixed(4)),
    calibration,
    action
  };
}

function rankOpportunities(prospects=[], opts={}) {
  return prospects.map(p=>scoreOpportunity(p,opts))
    .sort((a,b)=>{ const penalty=num(opts.riskPenaltyKZT,0); return (b.expectedNetProfitKZT-b.risk*penalty)-(a.expectedNetProfitKZT-a.risk*penalty); });
}

function allocateCapital(opportunities=[], input={}) {
  const budget=Math.max(0,num(input.budgetKZT,0));
  let remaining=budget;
  const minReserve=Math.max(0,num(input.reserveKZT,0));
  const maxPerOpportunity=Math.max(1,num(input.maxPerOpportunityKZT, remaining));
  const ranked=[...opportunities].sort((a,b)=>b.expectedNetProfitKZT-a.expectedNetProfitKZT);
  const allocations=ranked.map(o=>{
    const positive=o.action==="INVEST" && o.expectedNetProfitKZT>0 && o.purchaseProbability>=(input.minProbability??0.35);
    const amount=positive ? Math.min(maxPerOpportunity,Math.max(0,remaining-minReserve),Math.max(0,o.expectedExecutionCostKZT)) : 0;
    remaining-=amount;
    return {opportunityId:o.opportunityId, allocationKZT:Math.round(amount), decision:amount>0?"INVEST":"SKIP", expectedNetProfitKZT:o.expectedNetProfitKZT};
  });
  return {budgetKZT:budget, allocatedKZT:Math.round(budget-remaining), remainingKZT:Math.round(remaining), allocations};
}

function buildOpportunitySet(prospects=[], opts={}) {
  const ranked=rankOpportunities(prospects,opts);
  return {generatedAt:new Date().toISOString(),count:ranked.length,opportunities:ranked,allocation:allocateCapital(ranked,opts)};
}

module.exports={domainOf,recencyFactor,extractSignals,probabilityFromSignals,outcomeCalibration,scoreOpportunity,rankOpportunities,allocateCapital,buildOpportunitySet};
