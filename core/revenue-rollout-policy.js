"use strict";
function policy(input={}){
  const shadow=Boolean(input.shadowMode);
  const auto=Boolean(input.autoReply);
  const gate=Boolean(input.revenueGate);
  const allowed=Boolean(input.allowedByRevenue);
  const critic=String(input.criticVerdict||"FAIL").toUpperCase();
  const send=Boolean(input.reply) && auto && !shadow && (!gate || (allowed && critic==="PASS"));
  return {send,status:send?"SENT":shadow?"SHADOWED":"BLOCKED",reason:send?"GATES_PASSED":shadow?"SHADOW_MODE":"GATE_BLOCKED"};
}
module.exports={policy};
