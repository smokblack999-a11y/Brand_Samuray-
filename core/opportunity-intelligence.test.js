"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const oi=require("./opportunity-intelligence");

test("scores expected profit instead of raw lead score",()=>{
  const r=oi.scoreOpportunity({
    tenantId:"t1",
    source:"apollo",
    lead:{company:"High Value SaaS",domain:"high.example",email:"ceo@high.example",name:"CEO"},
    qualification:{score:70},
    signals:["sales","pricing","growth"],
    dealValueKZT:500000,
    grossMarginRate:0.4,
    expectedExecutionCostKZT:1000
  });
  assert.ok(r.purchaseProbability>0);
  assert.equal(r.expectedRevenueKZT,500000);
  assert.ok(r.expectedNetProfitKZT>0);
  assert.equal(r.action,"INVEST");
});

test("negative economics is skipped",()=>{
  const r=oi.scoreOpportunity({
    tenantId:"t1",
    source:"public-web",
    lead:{company:"Weak",domain:"weak.example"},
    qualification:{score:20},
    dealValueKZT:1000,
    grossMarginRate:0.1,
    expectedExecutionCostKZT:5000
  });
  assert.equal(r.action,"SKIP");
  assert.ok(r.expectedNetProfitKZT<0);
});

test("capital allocator never exceeds budget",()=>{
  const opportunities=[
    {opportunityId:"a",action:"INVEST",expectedNetProfitKZT:10000,purchaseProbability:0.8,expectedExecutionCostKZT:4000},
    {opportunityId:"b",action:"INVEST",expectedNetProfitKZT:5000,purchaseProbability:0.7,expectedExecutionCostKZT:4000}
  ];
  const r=oi.allocateCapital(opportunities,{budgetKZT:5000,maxPerOpportunityKZT:4000,minProbability:0.35});
  assert.ok(r.allocatedKZT<=5000);
  assert.ok(r.remainingKZT>=0);
});

test("stale observations decay",()=>{
  const old=new Date(Date.now()-24*30*3600000).toISOString();
  assert.ok(oi.recencyFactor(old)<0.5);
});
