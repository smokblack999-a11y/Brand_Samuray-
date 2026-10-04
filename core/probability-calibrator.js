"use strict";

function clamp(value, min=0, max=1) { return Math.max(min, Math.min(max, Number(value) || 0)); }

function calibrateProbability(heuristicProbability, historicalStats, options={}) {
  const h=clamp(heuristicProbability);
  const s=historicalStats || {};
  const trials=Math.max(0, Number(s.trials || 0));
  const successes=Math.max(0, Math.min(trials, Number(s.successes || 0)));
  const priorStrength=Math.max(1, Number(options.priorStrength || 12));
  const maxWeight=Math.max(0, Math.min(1, Number(options.maxWeight == null ? 0.85 : options.maxWeight)));
  if (trials === 0) return { probability:h, empirical:h, weight:0, trials:0, successes:0 };
  const empirical=(successes + priorStrength*h) / (trials + priorStrength);
  const weight=Math.min(maxWeight, trials / Math.max(1, Number(options.fullWeightTrials || 50)));
  const probability=clamp(h*(1-weight)+empirical*weight);
  return { probability:Number(probability.toFixed(4)), empirical:Number(empirical.toFixed(4)), weight:Number(weight.toFixed(4)), trials, successes };
}

function buildActionStats(records=[]) {
  const stats={};
  for (const r of records) {
    const action=String(r.action || "").trim();
    if(!action) continue;
    if(!stats[action]) stats[action]={trials:0,successes:0};
    stats[action].trials += 1;
    if(String(r.outcome || "").toUpperCase() === "WON") stats[action].successes += 1;
  }
  return stats;
}

module.exports={calibrateProbability,buildActionStats};
