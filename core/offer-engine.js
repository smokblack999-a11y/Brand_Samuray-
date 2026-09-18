"use strict";

const ACTIONS = Object.freeze({
  hot: { action: "human_close", priority: "P0", slaMinutes: 5, reason: "High purchase intent; route to a human immediately." },
  warm: { action: "qualify", priority: "P1", slaMinutes: 30, reason: "Useful intent is present; ask one qualifying question." },
  cold: { action: "nurture", priority: "P2", slaMinutes: 240, reason: "Insufficient buying evidence; avoid aggressive selling." }
});

function buildOffer(lead, businessName = "SamuraiOS") {
  const intent = lead && ACTIONS[lead.intent] ? lead.intent : "cold";
  const plan = ACTIONS[intent];
  const score = Math.max(0, Math.min(100, Number(lead?.score) || 0));
  return {
    business: String(businessName || "SamuraiOS").trim(),
    intent,
    score,
    action: plan.action,
    priority: plan.priority,
    slaMinutes: plan.slaMinutes,
    reason: plan.reason,
    conversionGuard: intent === "hot" ? "Do not invent price, availability or guarantees; use verified business facts." : "Collect missing facts before making an offer."
  };
}

module.exports = { ACTIONS, buildOffer };
