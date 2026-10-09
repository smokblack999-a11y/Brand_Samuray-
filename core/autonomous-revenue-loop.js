"use strict";

const crypto = require("node:crypto");
const revenueRuntime = require("./x27-runtime");
const { constrainDecision } = require("./budget-governor");
const x33 = require("./x33-service");

const FINAL_OUTCOMES = new Set(["WON", "LOST", "REFUNDED", "CANCELLED"]);

function text(value, max = 4000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function createCorrelationId(prefix = "rev") {
  return prefix + "_" + crypto.randomUUID();
}

function evaluateLead(input = {}) {
  const tenantId = text(input.tenantId, 128);
  const leadId = text(input.leadId, 256);
  const message = text(input.message);
  if (!tenantId) throw Object.assign(new Error("tenantId is required"), { code: "TENANT_REQUIRED" });
  if (!leadId) throw Object.assign(new Error("leadId is required"), { code: "LEAD_REQUIRED" });
  if (!message) throw Object.assign(new Error("message is required"), { code: "MESSAGE_REQUIRED" });

  const decision = revenueRuntime.decide(tenantId, {
    leadScore: positiveNumber(input.leadScore),
    intent: text(input.intent, 64) || "unknown",
    dealValue: positiveNumber(input.dealValueKZT, 0),
    grossMargin: positiveNumber(input.grossMarginRate, 0),
    occurredAt: input.occurredAt || new Date().toISOString(),
    responseSlaBreached: Boolean(input.responseSlaBreached),
    triggerRelevance: positiveNumber(input.triggerRelevance, 0),
    contactAllowed: input.contactAllowed !== false,
    customerOptedOut: Boolean(input.customerOptedOut),
    risk: positiveNumber(input.risk, 0),
    leadId,
    correlationId: text(input.correlationId, 256) || createCorrelationId("lead")
  });

  const monthlyBudgetKZT = positiveNumber(
    input.monthlyBudgetKZT,
    Number(process.env.REVENUE_MONTHLY_BUDGET_KZT || 0)
  );
  const constrained = monthlyBudgetKZT > 0
    ? constrainDecision(decision.record, {
        tenantId,
        monthlyBudgetKZT,
        usedKZT: positiveNumber(input.spentKZT, 0)
      })
    : decision.record;

  return {
    correlationId: decision.record.correlationId || input.correlationId || null,
    decision: decision.record,
    constrained,
    nextAction: constrained.action || constrained.recommendedAction || decision.record.action
  };
}

async function recordExecution(input = {}) {
  const tenantId = text(input.tenantId, 128);
  const decisionId = text(input.decisionId, 256);
  const executionId = text(input.executionId, 256) || createCorrelationId("exec");
  if (!tenantId || !decisionId) throw Object.assign(new Error("tenantId and decisionId are required"), { code: "EXECUTION_CONTEXT_REQUIRED" });

  const economicGate = await x33.authorize({
    tenantId,
    eventId: executionId,
    estimateKZT: positiveNumber(input.estimatedCostKZT, positiveNumber(input.actionCostKZT, 0)),
    ttlMs: Number(input.reservationTtlMs || 900000)
  });

  const execution = revenueRuntime.recordExecution(tenantId, {
    executionId,
    decisionId,
    action: text(input.action, 128),
    status: text(input.status, 64) || "EXECUTED",
    channel: text(input.channel, 64),
    externalId: text(input.externalId, 256),
    correlationId: text(input.correlationId, 256),
    result: input.result || null
  });
  return { execution, economicGate };
}

function recordPayment(input = {}) {
  const tenantId = text(input.tenantId, 128);
  const paymentId = text(input.paymentId, 256);
  if (!tenantId || !paymentId) {
    throw Object.assign(new Error("tenantId and paymentId are required"), { code: "PAYMENT_CONTEXT_REQUIRED" });
  }

  const amountKZT = positiveNumber(input.amountKZT, 0);
  if (amountKZT <= 0) {
    throw Object.assign(new Error("amountKZT must be greater than zero"), { code: "INVALID_PAYMENT_AMOUNT" });
  }

  return revenueRuntime.recordOutcome(tenantId, {
    eventId: "payment:" + paymentId,
    actionId: text(input.decisionId, 256),
    status: "WON",
    amountKZT,
    attributableRevenueKZT: amountKZT,
    attributableGrossProfitKZT: positiveNumber(input.attributableGrossProfitKZT, 0),
    grossMarginRate: positiveNumber(input.grossMarginRate, 0),
    actualCostKZT: positiveNumber(input.actualCostKZT, 0),
    baselineConversionProbability: positiveNumber(input.baselineConversionProbability, 0),
    controlConversionProbability: positiveNumber(input.controlConversionProbability, 0),
    treatmentConversionProbability: positiveNumber(input.treatmentConversionProbability, 0),
    provider: text(input.provider, 64) || "payment-provider",
    model: "",
    costId: text(input.costId, 256),
    source: "payment-webhook",
    correlationId: text(input.correlationId, 256)
  });
}

async function recordOutcome(input = {}) {
  const tenantId = text(input.tenantId, 128);
  const eventId = text(input.eventId, 256);
  if (!tenantId || !eventId) throw Object.assign(new Error("tenantId and eventId are required"), { code: "OUTCOME_CONTEXT_REQUIRED" });

  const status = text(input.status, 32).toUpperCase();
  if (!FINAL_OUTCOMES.has(status)) {
    throw Object.assign(new Error("status must be WON, LOST, REFUNDED or CANCELLED"), { code: "INVALID_OUTCOME_STATUS" });
  }

  const economicSettlement = input.reservationId
    ? await x33.settle({
        reservationId: text(input.reservationId, 256),
        actualKZT: positiveNumber(input.actualCostKZT, 0)
      })
    : { enabled: x33.enabled(), skipped: true, reason: "NO_RESERVATION_ID" };

  return revenueRuntime.recordOutcome(tenantId, {
    eventId,
    actionId: text(input.decisionId, 256),
    status,
    amountKZT: positiveNumber(input.amountKZT, 0),
    attributableRevenueKZT: positiveNumber(input.attributableRevenueKZT, 0),
    attributableGrossProfitKZT: positiveNumber(input.attributableGrossProfitKZT, 0),
    grossMarginRate: positiveNumber(input.grossMarginRate, 0),
    actualCostKZT: positiveNumber(input.actualCostKZT, 0),
    baselineConversionProbability: positiveNumber(input.baselineConversionProbability, 0),
    controlConversionProbability: positiveNumber(input.controlConversionProbability, 0),
    treatmentConversionProbability: positiveNumber(input.treatmentConversionProbability, 0),
    provider: text(input.provider, 64),
    model: text(input.model, 128),
    costId: text(input.costId, 256),
    source: text(input.source, 64) || "autonomous-revenue-loop",
    correlationId: text(input.correlationId, 256)
  }).then(result => ({ ...result, economicSettlement }));
}

function snapshot(tenantId) {
  return {
    summary: revenueRuntime.summary(tenantId),
    integrity: revenueRuntime.integrity(tenantId),
    decisions: revenueRuntime.list(tenantId, "DECISION").slice(0, 20),
    executions: revenueRuntime.list(tenantId, "EXECUTION").slice(0, 20),
    outcomes: revenueRuntime.list(tenantId, "OUTCOME").slice(0, 20),
    learning: revenueRuntime.list(tenantId, "LEARNING").slice(0, 20),
    observations: revenueRuntime.list(tenantId, "OBSERVATION").slice(0, 50)
  };
}

module.exports = {
  evaluateLead,
  recordExecution,
  recordOutcome,
  recordPayment,
  snapshot,
  FINAL_OUTCOMES
};
