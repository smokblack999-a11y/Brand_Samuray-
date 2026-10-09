"use strict";

const x41 = require("./x41-deterministic-arbiter");
const x33 = require("./x33-service");

const AUTH = Symbol("samurai.execution.authorization");

function clean(v, max=256) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function envBool(name, fallback=false) {
  const v = String(process.env[name] ?? fallback).toLowerCase();
  return v === "true" || v === "1";
}

function microKzt(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 1000000))) {
    throw Object.assign(new Error((field || "amount") + " must be finite and non-negative"), { code: "EXECUTION_GATE_INVALID_AMOUNT" });
  }
  return BigInt(Math.round(n * 1000000));
}

function policy() {
  return {
    activePolicy: Math.max(1, Number(process.env.X39_POLICY_VERSION || 1)),
    maxLossLimitMicro: clean(process.env.X39_MAX_LOSS_MICRO || "10000000000"),
    dailyLossBudgetMicro: clean(process.env.X39_DAILY_LOSS_BUDGET_MICRO || "200000000000"),
    currentDailyLossMicro: clean(process.env.X39_CURRENT_DAILY_LOSS_MICRO || "0"),
    maxCapitalReqMicro: clean(process.env.X39_MAX_CAPITAL_MICRO || "100000000000"),
    staleDataWindowMs: Math.max(1000, Number(process.env.X39_STALE_DATA_WINDOW_MS || 300000))
  };
}

function claimFromPlan(plan, nowMs = Date.now()) {
  const opportunity = plan?.opportunity || {};
  const costKZT = Math.max(1, Number(opportunity.expectedExecutionCostKZT || plan?.allocation?.allocationKZT || 0));
  const profitKZT = Math.max(1, Number(opportunity.expectedGrossProfitKZT || opportunity.expectedNetProfitKZT || 0));
  const capitalKZT = Math.max(costKZT, Number(plan?.allocation?.allocationKZT || costKZT));
  const probability = Number(opportunity.purchaseProbability);
  const confidence = Number(opportunity.confidence);
  if (!Number.isFinite(probability) || !Number.isFinite(confidence)) {
    throw Object.assign(new Error("EXECUTION_GATE_EVIDENCE_INCOMPLETE"), { code: "EXECUTION_GATE_EVIDENCE_INCOMPLETE" });
  }
  return {
    id: clean(
      plan?.decision?.decisionId ||
      opportunity.opportunityId ||
      plan?.lead?.apolloPersonId ||
      plan?.lead?.email,
      256
    ),
    expectedProfitMicro: microKzt(profitKZT, "expectedProfitKZT").toString(),
    maxLossMicro: microKzt(costKZT, "maxLossKZT").toString(),
    capitalReqMicro: microKzt(capitalKZT, "capitalReqKZT").toString(),
    dataTimestamp: new Date(nowMs).toISOString(),
    policyVersion: Math.max(1, Number(process.env.X39_POLICY_VERSION || 1)),
    probability,
    confidence
  };
}

async function authorizePlan(plan, { x33Service = x33, nowMs = Date.now() } = {}) {
  if (plan?.actionPlan?.status !== "READY_FOR_EXECUTION") {
    return { authorized: false, reason: "ACTION_PLAN_NOT_READY" };
  }
  if (!envBool("REVENUE_AUTONOMOUS_EXECUTION_ENABLED", false) ||
      !envBool("APOLLO_AUTONOMOUS_OUTREACH_ENABLED", false)) {
    return { authorized: false, reason: "EXECUTION_SWITCHES_OFF" };
  }

  const claim = claimFromPlan(plan, nowMs);
  const decision = x41.evaluateClaim(claim, policy(), nowMs);
  if (decision.decision !== x41.DECISION.EXECUTE) {
    return { authorized: false, reason: decision.reason, decision };
  }

  if (!x33Service.enabled()) {
    if (!(envBool("X33_ALLOW_INSECURE_TEST_BYPASS", false) && process.env.NODE_ENV === "test")) {
      return { authorized: false, reason: "X33_DISABLED", decision };
    }
  }

  const reservation = await x33Service.authorize({
    tenantId: clean(plan?.opportunity?.tenantId || process.env.TENANT_ID || "default", 128),
    eventId: claim.id,
    estimateMicro: decision.recommendedRiskMicro,
    ttlMs: Math.max(1000, Number(process.env.X33_MAX_RESERVATION_TTL_MS || 900000))
  });

  if (!reservation?.authorized || !reservation?.reservation) {
    return { authorized: false, reason: "X33_RESERVATION_REQUIRED", decision, reservation };
  }

  const reservationId = String(reservation.reservation.reservationId || "");
  if (!reservationId) {
    return { authorized: false, reason: "X33_RESERVATION_ID_REQUIRED", decision, reservation };
  }

  const authorization = {
    decisionId: claim.id,
    policyVersion: claim.policyVersion,
    reservationId,
    riskSizeMicro: decision.recommendedRiskMicro,
    gateDecision: decision.decision,
    reserved: true,
    issuedAt: new Date(nowMs).toISOString()
  };
  Object.defineProperty(authorization, AUTH, { value: true, enumerable: false });
  return { authorized: true, authorization, decision, reservation };
}

function assertAuthorization(authorization) {
  if (!authorization || authorization[AUTH] !== true) {
    throw Object.assign(new Error("EXECUTION_AUTHORIZATION_REQUIRED"), { code: "EXECUTION_AUTHORIZATION_REQUIRED" });
  }
  if (authorization.gateDecision !== x41.DECISION.EXECUTE ||
      !authorization.reserved ||
      !clean(authorization.decisionId) ||
      !clean(authorization.reservationId)) {
    throw Object.assign(new Error("EXECUTION_AUTHORIZATION_INVALID"), { code: "EXECUTION_AUTHORIZATION_INVALID" });
  }
  return true;
}

module.exports = { policy, claimFromPlan, authorizePlan, assertAuthorization };
