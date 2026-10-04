"use strict";

function buildControlPlane({summary={},records=[],integrity={},genome=[]}={}){
  const learning=records.filter(x=>x.type==="LEARNING");
  const outcomes=records.filter(x=>x.type==="OUTCOME");
  const costs=records.filter(x=>x.type==="COST");
  const absError=learning.reduce((s,x)=>s+Math.abs(Number(x.forecastErrorKZT||0)),0);
  const signedError=learning.reduce((s,x)=>s+Number(x.forecastErrorKZT||0),0);
  const won=outcomes.filter(x=>x.status==="WON").length;
  const refunded=outcomes.filter(x=>x.status==="REFUNDED").length;
  const unknown=outcomes.filter(x=>x.status==="UNKNOWN").length;
  const unpriced=costs.filter(x=>x.costConfidence==="UNPRICED").length;
  const grossProfit=Number(summary.attributableGrossProfitKZT||0);
  const cost=Number(summary.actualCostKZT||0);
  return {
    northStar:{incrementalGrossProfitKZT:Math.round(grossProfit-cost),attributableGrossProfitKZT:Math.round(grossProfit),executionCostKZT:Math.round(cost),economicMultiple:cost>0?Number((grossProfit/cost).toFixed(2)):null},
    funnel:{outcomes:outcomes.length,won,refunded,unknown,learningRecords:learning.length},
    forecast:{meanAbsoluteErrorKZT:learning.length?Math.round(absError/learning.length):null,meanSignedErrorKZT:learning.length?Math.round(signedError/learning.length):null},
    dataQuality:{ledgerIntegrity:integrity.ok===true,unpricedCostRecords:unpriced,attributionRecords:outcomes.filter(x=>x.attributionStatus).length},
    genome:Array.isArray(genome)?genome:[],
    generatedAt:new Date().toISOString()
  };
}
module.exports={buildControlPlane};
