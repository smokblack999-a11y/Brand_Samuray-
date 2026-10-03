"use strict";
function buildLearningRecord(decision,attribution,actualCostKZT){
  if(!decision) throw new Error("decision is required");
  const expected=Number(decision.expectedIncrementalProfit||0), actual=Number((attribution&&attribution.attributableGrossProfitKZT)||0), cost=Math.max(0,Number(actualCostKZT||0));
  return {decisionId:decision.decisionId||null,action:decision.action||null,expectedIncrementalProfitKZT:Math.round(expected),actualAttributableGrossProfitKZT:Math.round(actual),actualCostKZT:Math.round(cost),forecastErrorKZT:Math.round(actual-expected),roiMultiple:cost>0?Number((actual/cost).toFixed(2)):null,outcome:(attribution&&attribution.status)||"UNKNOWN",createdAt:new Date().toISOString()};
}
function summarizeLearning(records){ records=Array.isArray(records)?records:[]; const e=records.reduce((s,x)=>s+Number(x.expectedIncrementalProfitKZT||0),0),a=records.reduce((s,x)=>s+Number(x.actualAttributableGrossProfitKZT||0),0),c=records.reduce((s,x)=>s+Number(x.actualCostKZT||0),0); return {decisions:records.length,expectedIncrementalProfitKZT:Math.round(e),actualAttributableGrossProfitKZT:Math.round(a),totalCostKZT:Math.round(c),aggregateForecastErrorKZT:Math.round(a-e),economicMultiple:c>0?Number((a/c).toFixed(2)):null}; }
module.exports={buildLearningRecord,summarizeLearning};