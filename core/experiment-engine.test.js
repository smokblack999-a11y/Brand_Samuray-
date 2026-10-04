"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {assignVariant,wilson,analyzeExperiment}=require("./experiment-engine");
test("variant assignment is deterministic",()=>{const e={id:"price-v1",variants:["A","B"],holdoutPct:0};assert.deepEqual(assignVariant(e,"lead-123"),assignVariant(e,"lead-123"));});
test("holdout remains explicit",()=>{const e={id:"exp",variants:["A","B"],holdoutPct:.5};const seen=[...Array(100)].map((_,i)=>assignVariant(e,"lead-"+i).variant);assert.ok(seen.includes("HOLDOUT"));});
test("wilson interval stays bounded",()=>{const x=wilson(5,10);assert.equal(x.rate,.5);assert.ok(x.low>=0&&x.high<=1&&x.low<x.high);});
test("experiment analysis exposes conversion and profit per exposure",()=>{const x=analyzeExperiment([{variant:"A",outcome:"WON",attributableGrossProfitKZT:100,actualCostKZT:10},{variant:"A",outcome:"LOST",attributableGrossProfitKZT:0,actualCostKZT:5}]);assert.equal(x[0].trials,2);assert.equal(x[0].wins,1);assert.equal(x[0].profitPerExposure,50);assert.equal(x[0].returnMultiple,6.67);});
