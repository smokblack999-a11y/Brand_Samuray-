"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildGenome}=require("./revenue-genome");
test("genome groups outcomes by segment and action",()=>{const g=buildGenome([{segment:"hot",action:"RESPOND",outcome:"WON",expectedIncrementalProfitKZT:100,actualAttributableGrossProfitKZT:120,actualCostKZT:10},{segment:"hot",action:"RESPOND",outcome:"LOST",expectedIncrementalProfitKZT:100,actualAttributableGrossProfitKZT:0,actualCostKZT:10}]);assert.equal(g.length,1);assert.equal(g[0].trials,2);assert.equal(g[0].wins,1);assert.equal(g[0].winRate,.5);assert.equal(g[0].returnMultiple,6);});
