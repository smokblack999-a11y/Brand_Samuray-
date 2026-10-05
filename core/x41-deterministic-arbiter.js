"use strict";

/**
 * X41 Deterministic Arbiter
 *
 * Pure policy evaluation. No LLM, I/O, clocks, network calls or mutable state.
 * Monetary values are integer micro-KZT strings/BigInt to avoid floating-point
 * accounting errors.
 */

const DECISION = Object.freeze({ EXECUTE: "EXECUTE", VETO: "VETO" });
const LEVEL = Object.freeze({ GREEN: "GREEN", YELLOW: "YELLOW", RED: "RED", BLACK: "BLACK" });

const REASON = Object.freeze({
  INVALID_CLAIM: "INVALID_CLAIM",
  POLICY_MISMATCH: "MISMATCHED_POLICY_VERSION",
  STALE_DATA: "STALE_MARKET_DATA",
  MAX_LOSS_EXCEEDED: "MAX_LOSS_EXCEEDED",
  CAPITAL_REQUIREMENT_EXCEEDED: "CAPITAL_REQUIREMENT_EXCEEDED",
  DAILY_LOSS_BUDGET_EXHAUSTED: "DAILY_LOSS_BUDGET_EXHAUSTED",
  NEGATIVE_EXPECTED_PROFIT: "NEGATIVE_EXPECTED_PROFIT",
  INSUFFICIENT_EDGE: "INSUFFICIENT_EXPECTED_EDGE",
  KELLY_SIZE_ZERO: "KELLY_SIZE_ZERO",
  ALL_CHECKS_PASSED: "ALL_CHECKS_PASSED"
});

function fail(message) {
  const e = new Error(message);
  e.code = REASON.INVALID_CLAIM;
  return e;
}

function money(value, field) {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw fail((field || "money") + " must be a non-negative integer micro-KZT value");
}

function fraction(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw fail((field || "fraction") + " must be in [0,1]");
  return n;
}

function positiveInt(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw fail((field || "integer") + " must be a positive safe integer");
  return value;
}

/**
 * Kelly fraction for a binary outcome:
 * f* = (b*p - q) / b
 * where b = net profit / loss, p = win probability, q = 1-p.
 *
 * The arbiter only uses Kelly as a sizing signal; policy caps remain authoritative.
 */
function kellyFraction(probability, expectedProfitMicro, maxLossMicro) {
  const p = fraction(probability, "probability");
  const profit = Number(expectedProfitMicro);
  const loss = Number(maxLossMicro);
  if (!Number.isFinite(profit) || !Number.isFinite(loss) || profit <= 0 || loss <= 0) return 0;
  const b = profit / loss;
  const q = 1 - p;
  const k = (b * p - q) / b;
  return Math.max(0, Math.min(1, k));
}

function evaluateClaim(claim, policy, nowMs) {
  if (!claim || !policy) throw fail("claim and policy are required");

  const maxLoss = money(claim.maxLossMicro ?? claim.maxLoss, "maxLoss");
  const capitalReq = money(claim.capitalReqMicro ?? claim.capitalReq, "capitalReq");
  const expectedProfit = money(claim.expectedProfitMicro ?? claim.expectedProfit, "expectedProfit");
  const dailyLoss = money(policy.currentDailyLossMicro ?? policy.currentDailyLoss ?? 0, "currentDailyLoss");
  const dailyBudget = money(policy.dailyLossBudgetMicro ?? policy.dailyLossBudget, "dailyLossBudget");
  const maxLossLimit = money(policy.maxLossLimitMicro ?? policy.maxLossLimit, "maxLossLimit");
  const maxCapitalReq = money(policy.maxCapitalReqMicro ?? policy.maxCapitalReq, "maxCapitalReq");

  positiveInt(policy.activePolicy, "activePolicy");
  if (!Number.isInteger(claim.policyVersion)) throw fail("claim.policyVersion must be an integer");
  if (claim.policyVersion !== policy.activePolicy) {
    return veto(REASON.POLICY_MISMATCH, LEVEL.RED);
  }

  const timestamp = Date.parse(claim.dataTimestamp);
  if (!Number.isFinite(timestamp)) throw fail("claim.dataTimestamp must be an ISO timestamp");
  if (!Number.isSafeInteger(nowMs)) throw fail("nowMs must be a safe integer timestamp");
  const age = nowMs - timestamp;
  if (age < 0 || age > policy.staleDataWindowMs) {
    return veto(REASON.STALE_DATA, LEVEL.RED, { dataAgeMs: age });
  }

  if (maxLoss > maxLossLimit) {
    return veto(REASON.MAX_LOSS_EXCEEDED, LEVEL.RED);
  }

  if (capitalReq > maxCapitalReq) {
    return veto(REASON.CAPITAL_REQUIREMENT_EXCEEDED, LEVEL.YELLOW);
  }

  if (expectedProfit <= 0n) {
    return veto(REASON.NEGATIVE_EXPECTED_PROFIT, LEVEL.RED);
  }

  if (dailyLoss + maxLoss > dailyBudget) {
    return veto(REASON.DAILY_LOSS_BUDGET_EXHAUSTED, LEVEL.BLACK);
  }

  const probability = fraction(claim.probability, "probability");
  const confidence = fraction(claim.confidence ?? 1, "confidence");
  const kelly = kellyFraction(probability, expectedProfit, maxLoss);
  const effectiveKelly = kelly * confidence;

  // Never allow a policy to allocate more than its explicit capital/risk caps.
  const kellySize = BigInt(Math.floor(Number(capitalReq) * effectiveKelly));
  if (kellySize <= 0n) {
    return veto(REASON.KELLY_SIZE_ZERO, LEVEL.YELLOW, {
      kellyFraction: kelly,
      effectiveKelly
    });
  }

  return {
    decision: DECISION.EXECUTE,
    reason: REASON.ALL_CHECKS_PASSED,
    vetoLevel: LEVEL.GREEN,
    kellyFraction: kelly,
    effectiveKelly,
    recommendedRiskMicro: (kellySize < maxLoss ? kellySize : maxLoss).toString(),
    checks: Object.freeze({
      policy: true,
      freshness: true,
      maxLoss: true,
      capital: true,
      dailyLossBudget: true,
      expectedProfit: true,
      kelly: true
    })
  };
}

function veto(reason, level, extra = {}) {
  return {
    decision: DECISION.VETO,
    reason,
    vetoLevel: level,
    ...extra
  };
}

module.exports = {
  DECISION,
  LEVEL,
  REASON,
  evaluateClaim,
  kellyFraction
};
