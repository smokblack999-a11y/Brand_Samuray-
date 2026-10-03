"use strict";

function groupRecords(records){
  const groups={};
  for(const row of Array.isArray(records)?records:[]){
    const segment=String(row.segment||row.intent||"unknown").trim().toLowerCase()||"unknown";
    const action=String(row.action||"unknown").trim().toLowerCase()||"unknown";
    const id=segment+"::"+action;
    if(!groups[id]) groups[id]={segment,action,trials:0,wins:0,expectedProfitKZT:0,actualProfitKZT:0,costKZT:0};
    groups[id].trials+=1;
    if(String(row.outcome||"").toUpperCase()==="WON") groups[id].wins+=1;
    groups[id].expectedProfitKZT+=Number(row.expectedIncrementalProfitKZT||0);
    groups[id].actualProfitKZT+=Number(row.actualAttributableGrossProfitKZT||0);
    groups[id].costKZT+=Number(row.actualCostKZT||0);
  }
  return groups;
}

function buildGenome(records){
  return Object.values(groupRecords(records)).map(g=>Object.assign({},g,{winRate:g.trials?Number((g.wins/g.trials).toFixed(4)):0,returnMultiple:g.costKZT>0?Number((g.actualProfitKZT/g.costKZT).toFixed(2)):null}));
}

module.exports={buildGenome,groupRecords};
