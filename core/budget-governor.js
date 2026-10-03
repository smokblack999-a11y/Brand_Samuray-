"use strict";

function clamp(v,min=0,max=1){return Math.max(min,Math.min(max,Number(v)||0));}
function evaluateBudget(input={}){
  const budgetKZT=Math.max(0,Number(input.monthlyBudgetKZT!=null?input.monthlyBudgetKZT:30000));
  const usedKZT=Math.max(0,Number(input.usedKZT||0));
  const softLimitPct=clamp(input.softLimitPct!=null?input.softLimitPct:.80);
  const hardLimitPct=clamp(input.hardLimitPct!=null?input.hardLimitPct:1);
  const estimatedCostKZT=Math.max(0,Number(input.estimatedCostKZT||0));
  const soft=budgetKZT*softLimitPct,hard=budgetKZT*hardLimitPct;
  const remaining=Math.max(0,budgetKZT-usedKZT);
  let mode="PRIMARY";
  if(usedKZT>=hard)mode="BLOCKED";
  else if(usedKZT>=soft)mode="LIGHT";
  const affordable=estimatedCostKZT<=remaining && usedKZT+estimatedCostKZT<=hard;
  return {budgetKZT,usedKZT,remainingKZT:Math.round(remaining),softLimitKZT:Math.round(soft),hardLimitKZT:Math.round(hard),estimatedCostKZT,mode,affordable};
}
function constrainDecision(decision,budgetInput={}){
  const base=evaluateBudget(Object.assign({},budgetInput,{estimatedCostKZT:decision?.candidates?.[0]?.actionCost||0}));
  if(base.mode==="BLOCKED")return Object.assign({},decision,{recommendedAction:"DO_NOT_CONTACT",action:"DO_NOT_CONTACT",expectedValue:0,expectedIncrementalProfitKZT:0,budget:base});
  const candidates=Array.isArray(decision?.candidates)?decision.candidates:[];
  const affordable=candidates.filter(c=>c.action==="DO_NOT_CONTACT" || (Number(c.actionCost||0)<=base.remainingKZT && Number(c.riskPenalty||0)<1e8));
  const chosen=affordable[0]||candidates.find(c=>c.action==="DO_NOT_CONTACT");
  if(!chosen)return Object.assign({},decision,{recommendedAction:"DO_NOT_CONTACT",action:"DO_NOT_CONTACT",expectedValue:0,expectedIncrementalProfitKZT:0,budget:Object.assign({},base,{affordable:false})});
  const changed=chosen.action!==decision.recommendedAction;
  return Object.assign({},decision,{recommendedAction:changed?chosen.action:decision.recommendedAction,action:changed?chosen.action:decision.action,expectedValue:changed?chosen.expectedValue:decision.expectedValue,expectedIncrementalProfitKZT:changed?chosen.expectedValue:decision.expectedIncrementalProfitKZT,budget:Object.assign({},base,{estimatedCostKZT:Number(chosen.actionCost||0),affordable:true,constrained:changed})});
}
module.exports={evaluateBudget,constrainDecision};
