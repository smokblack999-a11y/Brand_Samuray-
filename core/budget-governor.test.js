"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {evaluateBudget,constrainDecision}=require("./budget-governor");
test("hard budget blocks execution",()=>{const x=evaluateBudget({monthlyBudgetKZT:30000,usedKZT:30000,estimatedCostKZT:250});assert.equal(x.mode,"BLOCKED");assert.equal(x.affordable,false);});
test("soft budget is visible before hard block",()=>{const x=evaluateBudget({monthlyBudgetKZT:30000,usedKZT:24000,estimatedCostKZT:250});assert.equal(x.mode,"LIGHT");assert.equal(x.affordable,true);});
test("governor falls back to affordable candidate",()=>{const x=constrainDecision({recommendedAction:"RESPOND",expectedValue:1000,expectedIncrementalProfitKZT:1000,candidates:[{action:"RESPOND",expectedValue:1000,actionCost:1000,riskPenalty:0},{action:"WAIT",expectedValue:200,actionCost:25,riskPenalty:0}]},{monthlyBudgetKZT:1000,usedKZT:950});assert.equal(x.recommendedAction,"WAIT");assert.equal(x.budget.constrained,true);});
