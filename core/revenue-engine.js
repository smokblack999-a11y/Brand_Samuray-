"use strict";

/**
 * SamuraiOS X26 — Revenue Allocator
 * Deterministic, explainable decision layer.
 * X26-v1 is a heuristic policy model, not calibrated ML.
 */

const MODEL_VERSION = "x26-v1-heuristic";

const ACTION_COSTS = Object.freeze({
  RESPOND: 250,
  FOLLOW_UP: 300,
  REACTIVATE: 350,
  HUMAN_ESCALATION: 900,
  WAIT: 25,
  DO_NOT_CONTACT: 0
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clampInt(value, min, max) {
  return Math.round(Math.max(min, Math.min(max, Number(value) || 0)));
}

function ageDays(occurredAt, now = new Date()) {
  const ts = Date.parse(String(occurredAt || ""));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (now.getTime() - ts) / 86400000);
}

function recencyFactor(days) {
  if (days == null) return 0.45;
  if (days <= 3) return 1;
  if (days <= 7) return 0.92;
  if (days <= 14) return 0.82;
  if (days <= 30) return 0.68;
  if (days <= 60) return 0.5;
  if (days <= 120) return 0.3;
  return 0.12;
}

function intentFactor(intent, score) {
  if (Number.isFinite(Number(score))) return clamp(Number(score) / 100);
  const key = String(intent || "").toLowerCase();
  return key === "hot" ? 0.9 : key === "warm" ? 0.6 : key === "cold" ? 0.25 : 0.35;
}

function valueFactor(dealValue, referenceValue = 1000000) {
  const v = Math.max(0, Number(dealValue) || 0);
  const ref = Math.max(1, Number(referenceValue) || 1000000);
  if (v === 0) return 0;
  return clamp(Math.log10(1 + v) / Math.log10(1 + ref));
}

function reasonFactor(reason) {
  const key = String(reason || "unknown").toLowerCase();
  if (["price", "timing", "no_followup", "scope"].includes(key)) return 0.9;
  if (["competitor", "trust"].includes(key)) return 0.68;
  return 0.5;
}

function buildBaseSignals(input, now) {
  const days = ageDays(input.occurredAt || input.lastContactAt || input.updatedAt, now);
  const recency = recencyFactor(days);
  const intent = intentFactor(input.intent, input.leadScore);
  const value = valueFactor(input.dealValue, input.referenceDealValue);
  const engagement = clamp(
    input.engagementScore != null
      ? Number(input.engagementScore) / 100
      : Math.min(1, Math.max(0, Number(input.replyCount || 0) / 5))
  );
  const reason = reasonFactor(input.lossReason);
  const trigger = clamp(input.triggerRelevance);
  const contactAllowed = input.contactAllowed !== false;
  const previousReply = Boolean(input.previousCustomerReply);
  const daysSinceLastContact = ageDays(input.lastContactAt, now);

  return {
    daysSinceEvent: days,
    daysSinceLastContact,
    recency,
    intent,
    value,
    engagement,
    reason,
    trigger,
    contactAllowed,
    previousReply
  };
}

function recoveryScore(input, signals) {
  const score =
    30 * signals.recency +
    22 * signals.intent +
    18 * signals.value +
    12 * signals.engagement +
    10 * signals.reason +
    8 * signals.trigger;

  const contactPenalty = signals.contactAllowed ? 0 : 45;
  const stalePenalty = signals.daysSinceEvent != null && signals.daysSinceEvent > 180 ? 12 : 0;

  return clampInt(score - contactPenalty - stalePenalty, 0, 100);
}

function successProbability(action, input, s) {
  let p =
    0.05 +
    0.27 * s.intent +
    0.18 * s.engagement +
    0.17 * s.reason +
    0.13 * s.recency +
    0.10 * s.trigger +
    0.10 * s.value;

  if (action === "RESPOND") {
    if (input.responseSlaBreached) p += 0.12;
    if (input.leadScore != null && Number(input.leadScore) >= 70) p += 0.08;
  }

  if (action === "FOLLOW_UP") {
    if (input.previousCustomerReply) p += 0.10;
    if (s.daysSinceLastContact != null && s.daysSinceLastContact >= 1 && s.daysSinceLastContact <= 14) p += 0.06;
  }

  if (action === "REACTIVATE") {
    p += 0.10 * s.trigger;
    p += 0.06 * s.reason;
  }

  if (action === "HUMAN_ESCALATION") {
    if (Number(input.dealValue) >= Number(input.humanEscalationValue || 1000000)) p += 0.10;
    if (input.risk === "high") p += 0.08;
  }

  if (action === "WAIT") {
    p = 0.06 + 0.20 * s.trigger + 0.10 * s.recency;
  }

  if (action === "DO_NOT_CONTACT") p = 0;

  return clamp(p, 0.01, 0.95);
}

function riskPenalty(action, input, s) {
  let penalty = 0;

  if (action !== "DO_NOT_CONTACT" && !s.contactAllowed) penalty += 1000000000;
  if (action === "REACTIVATE" && !s.trigger && s.daysSinceEvent != null && s.daysSinceEvent < 7) penalty += 500;
  if (input.marginRisk === "high" && ["REACTIVATE", "FOLLOW_UP"].includes(action)) penalty += 250;
  if (input.customerOptedOut) penalty += 1000000000;

  return penalty;
}

function grossProfit(input) {
  const revenue = Math.max(0, Number(input.dealValue) || 0);
  const margin = clamp(
    input.grossMargin != null ? Number(input.grossMargin) : 0.30,
    0,
    1
  );

  return {
    revenue,
    margin,
    grossProfit: revenue * margin,
    marginAssumed: input.grossMargin == null
  };
}

function candidateActions(input, s) {
  const gp = grossProfit(input).grossProfit;
  const actions = [
    "RESPOND",
    "FOLLOW_UP",
    "REACTIVATE",
    "HUMAN_ESCALATION",
    "WAIT",
    "DO_NOT_CONTACT"
  ];

  return actions.map(action => {
    const probability = successProbability(action, input, s);
    const expectedGrossProfit = gp * probability;
    const cost = ACTION_COSTS[action];
    const penalty = riskPenalty(action, input, s);
    const expectedValue = expectedGrossProfit - cost - penalty;

    return {
      action,
      probability: Number(probability.toFixed(4)),
      expectedGrossProfit: Math.round(expectedGrossProfit),
      actionCost: cost,
      riskPenalty: penalty,
      expectedValue: Math.round(expectedValue)
    };
  }).sort((a, b) => b.expectedValue - a.expectedValue);
}

function chooseNextAction(input, now = new Date()) {
  const safeInput = input && typeof input === "object" ? input : {};
  const signals = buildBaseSignals(safeInput, now);
  const gp = grossProfit(safeInput);
  const recovery = recoveryScore(safeInput, signals);
  const candidates = candidateActions(safeInput, signals);
  const best = candidates[0];

  const suppressed =
    safeInput.customerOptedOut === true ||
    signals.contactAllowed === false;

  return {
    modelVersion: MODEL_VERSION,
    decisionId: safeInput.decisionId || ("x26-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)),
    recoveryScore: recovery,
    recommendedAction: suppressed ? "DO_NOT_CONTACT" : best.action,
    expectedValue: suppressed ? 0 : best.expectedValue,
    dealValue: gp.revenue,
    grossMargin: gp.margin,
    marginAssumed: gp.marginAssumed,
    signals,
    candidates,
    explanation: {
      why: suppressed
        ? "Contact is suppressed by tenant/customer policy."
        : ("Best risk-adjusted expected value among allowed actions: " + best.action + "."),
      assumptions: [
        gp.marginAssumed
          ? "grossMargin was not supplied; 30% default is an assumption"
          : "grossMargin supplied by caller",
        "success probabilities are heuristic and must be calibrated against actual outcomes"
      ]
    }
  };
}

function attributeRevenue(input) {
  const dealValue = Math.max(0, Number(input?.dealValue) || 0);
  const recoveredRevenue = Math.max(0, Number(input?.recoveredRevenue) || 0);
  const aiCost = Math.max(0, Number(input?.aiCost) || 0);
  const humanCost = Math.max(0, Number(input?.humanCost) || 0);
  const grossMargin = clamp(input?.grossMargin != null ? Number(input.grossMargin) : 0.30);

  const attributedGrossProfit = recoveredRevenue * grossMargin;
  const totalInterventionCost = aiCost + humanCost;
  const incrementalGrossProfit = attributedGrossProfit - totalInterventionCost;
  const roiMultiple = totalInterventionCost > 0
    ? attributedGrossProfit / totalInterventionCost
    : null;

  return {
    modelVersion: MODEL_VERSION,
    dealValue,
    recoveredRevenue,
    grossMargin,
    attributedGrossProfit: Math.round(attributedGrossProfit),
    aiCost,
    humanCost,
    totalInterventionCost,
    incrementalGrossProfit: Math.round(incrementalGrossProfit),
    roiMultiple: roiMultiple == null ? null : Number(roiMultiple.toFixed(3)),
    outcome: recoveredRevenue > 0 ? "RECOVERED" : "NOT_RECOVERED"
  };
}

module.exports = {
  MODEL_VERSION,
  ACTION_COSTS,
  chooseNextAction,
  attributeRevenue,
  recoveryScore
};
