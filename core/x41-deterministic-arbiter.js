"use strict";

/**
 * X41 — Deterministic Arbiter.
 *
 * Policy is immutable for an evaluation. No LLM calls, wall-clock mutation,
 * network calls, or hidden state are allowed inside evaluateClaim().
 * Money is represented as integer micro-KZT in production-facing boundaries;
 * this core keeps the numeric policy API simple and rejects NaN/Infinity.
 */

const DECISION = Object.freeze({ EXECUTE: "EXECUTE", VETO: "VETO" });
const LEVEL = Object.freeze({ GREEN: "GREEN", YELLOW: "YELLOW", RED: "RED", BLACK: "BLACK" });

const REASONS = Object.freeze({
  INVALID_CLAIM: "INVALID_CLAIM",
  MISMATCHED_POLICY_VERSION: "MISMATCHED_POLICY_VERSION",
  STALE_DATA: "STALE_MARKET_DATA",
  MAX_LOSS_EXCEEDED: "MAX_LOSS_EXCEEDED",
  CAPITAL_REQUIREMENT_EXCEEDED: "CAPITAL_REQUIREMENT_EXCEEDED",
  DAILY_LOSS_BUDGET_EXHAUSTED: "DAILY_LOSS_BUDGET_EXHAUSTED",
  NEGATIVE_EXPECTED_PROFIT: "NEGATIVE_EXPECTED_PROFIT",
  NON_POSITIVE_EDGE: "NON_POSITIVE_EDGE",
  KELLY_NON_POSITIVE: "KELLY_NON_POSITIVE",
  KELLY_SIZING_EXCEEDED: "KELLY_SIZING_EXCEEDED",
  EVIDENCE_REQUIRED: "EVIDENCE_REQUIRED",
  ALL_CHECKS_PASSED: "ALL_CHECKS_PASSED"
});

function finiteNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(field + " must be finite");
  return n;
}

function validateClaim(claim) {
  if (!claim || typeof claim !== "object") return REASONS.INVALID_CLAIM;
  if (!claim.id || typeof claim.id !== "string") return REASONS.INVALID_CLAIM;
  for (const [field, min] of [["expectedProfit", 0], ["maxLoss", 0], ["capitalReq", 0], ["probability", 0], ["confidence", 0], ["riskScore", 0]]) {
    try {
      const n = finiteNumber(claim[field], field);
      if (n < min) return REASONS.INVALID_CLAIM;
    } catch (_) { return REASONS.INVALID_CLAIM; }
  }
  if (claim.probability > 1 || claim.confidence > 1 || claim.riskScore > 1) return REASONS.INVALID_CLAIM;
  if (!(claim.dataTimestamp instanceof Date) || Number.isNaN(claim.dataTimestamp.getTime())) return REASONS.INVALID_CLAIM;
  if (!Number.isInteger(claim.policyVersion)) return REASONS.INVALID_CLAIM;
  return null;
}

/**
 * Conservative Kelly fraction for a binary opportunity:
 * f* = (b*p - q) / b, where b is net profit/loss ratio.
 * Confidence scales the fraction; risk score penalizes it.
 */
function kellyFraction(claim) {
  const p = finiteNumber(claim.probability, "probability");
  const q = 1 - p;
  if (claim.maxLoss <= 0) return 0;
  const b = claim.expectedProfit / claim.maxLoss;
  if (!(b > 0)) return 0;
  return Math.max(0, ((b * p) - q) / b);
}

function evaluateClaim(claim, policy, now = new Date()) {
  if (!policy || typeof policy !== "object") throw new TypeError("policy is required");
  const invalid = validateClaim(claim);
  if (invalid) return veto(invalid, LEVEL.RED);

  const activePolicy = Number(policy.activePolicyVersion);
  if (!Number.isInteger(activePolicy) || claim.policyVersion !== activePolicy)
    return veto(REASONS.MISMATCHED_POLICY_VERSION, LEVEL.RED);

  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError("now must be a valid Date");

  const staleWindowMs = finiteNumber(policy.staleDataWindowMs, "staleDataWindowMs");
  if (staleWindowMs < 0 || current.getTime() - claim.dataTimestamp.getTime() > staleWindowMs)
    return veto(REASONS.STALE_DATA, LEVEL.RED);

  if (claim.maxLoss > finiteNumber(policy.maxLossLimit, "maxLossLimit"))
    return veto(REASONS.MAX_LOSS_EXCEEDED, LEVEL.RED);

  if (claim.capitalReq > finiteNumber(policy.maxCapitalReq, "maxCapitalReq"))
    return veto(REASONS.CAPITAL_REQUIREMENT_EXCEEDED, LEVEL.YELLOW);

  if (claim.expectedProfit <= 0)
    return veto(REASONS.NEGATIVE_EXPECTED_PROFIT, LEVEL.RED);

  const edge = claim.probability * claim.expectedProfit - (1 - claim.probability) * claim.maxLoss;
  if (!(edge > 0))
    return veto(REASONS.NON_POSITIVE_EDGE, LEVEL.RED);

  if (policy.requireEvidence && (!Array.isArray(claim.evidence) || claim.evidence.length === 0))
    return veto(REASONS.EVIDENCE_REQUIRED, LEVEL.RED);

  const rawKelly = kellyFraction(claim);
  if (!(rawKelly > 0))
    return veto(REASONS.KELLY_NON_POSITIVE, LEVEL.RED);

  const confidence = Math.max(0, Math.min(1, claim.confidence));
  const riskPenalty = 1 - Math.max(0, Math.min(1, claim.riskScore)) * finiteNumber(policy.riskPenalty, "riskPenalty");
  const sizedFraction = Math.max(0, rawKelly * confidence * Math.max(0, riskPenalty));
  const cappedFraction = Math.min(sizedFraction, finiteNumber(policy.maxKellyFraction, "maxKellyFraction"));
  const dailyRemaining = finiteNumber(policy.dailyLossBudget, "dailyLossBudget") -
    finiteNumber(policy.currentDailyLoss, "currentDailyLoss");

  if (dailyRemaining <= 0 || claim.maxLoss > dailyRemaining)
    return veto(REASONS.DAILY_LOSS_BUDGET_EXHAUSTED, LEVEL.BLACK);

  const riskBudget = Math.min(claim.maxLoss, dailyRemaining);
  const kellyRisk = claim.capitalReq * cappedFraction;

  if (!(kellyRisk > 0) || kellyRisk > riskBudget)
    return veto(REASONS.KELLY_SIZING_EXCEEDED, LEVEL.RED);

  return {
    decision: DECISION.EXECUTE,
    vetoLevel: LEVEL.GREEN,
    reason: REASONS.ALL_CHECKS_PASSED,
    riskBudget,
    kellyFraction: cappedFraction,
    rawKellyFraction: rawKelly,
    confidence,
    riskAdjustedKellyRisk: kellyRisk,
    policyVersion: claim.policyVersion
  };
}

function veto(reason, vetoLevel) {
  return {
    decision: DECISION.VETO,
    vetoLevel,
    reason,
    riskBudget: 0,
    kellyFraction: 0,
    rawKellyFraction: 0,
    confidence: 0,
    riskAdjustedKellyRisk: 0
  };
}

module.exports = {
  DECISION,
  LEVEL,
  REASONS,
  kellyFraction,
  evaluateClaim
};
