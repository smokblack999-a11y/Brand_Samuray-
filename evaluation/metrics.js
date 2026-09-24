"use strict";
function pct(n,d){return d?Number((n/d).toFixed(4)):0;}
function evaluate(rows){
 const total=rows.length;
 return {
  total,
  diagnosis_accuracy:pct(rows.filter(r=>r.diagnosisCorrect).length,total),
  path_accuracy:pct(rows.filter(r=>r.pathCorrect).length,total),
  expected_action_accuracy:pct(rows.filter(r=>r.actionCorrect).length,total),
  deterministic_replay:pct(rows.filter(r=>r.replayStable).length,total)
 };
}
module.exports={evaluate};
