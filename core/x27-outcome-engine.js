"use strict";

function normalizeOutcome(input) {
  const status = String((input && input.status) || "UNKNOWN").toUpperCase();
  const allowed = ["WON","LOST","UNKNOWN","REFUNDED","CANCELLED"];
  if (!allowed.includes(status)) throw new Error("Unsupported outcome: " + status);
  const revenueKZT = Math.max(0, Number((input && input.revenueKZT) || 0));
  const grossMarginRate = Math.min(1, Math.max(0, Number(input && input.grossMarginRate != null ? input.grossMarginRate : 0)));
  return { status, revenueKZT, grossMarginRate, realizedGrossProfitKZT: Math.round(revenueKZT * grossMarginRate), dealId: (input && input.dealId) || null, actionId: (input && input.actionId) || null, eventId: (input && input.eventId) || null };
}

function evaluateAttribution(outcome, baselineConversionProbability, policy, context={}) {
  const o = normalizeOutcome(outcome || {});
  if (o.status === "REFUNDED" && o.revenueKZT > 0) return Object.assign({}, o, { attributionStatus: "REVERSAL", incrementalShare: 1, attributableRevenueKZT: -o.revenueKZT, attributableGrossProfitKZT: -o.realizedGrossProfitKZT, reason: "REVENUE_REVERSAL_EVENT" });
  if (o.status !== "WON" || o.revenueKZT <= 0) return Object.assign({}, o, { attributionStatus: "NONE", attributableRevenueKZT: 0, attributableGrossProfitKZT: 0 });
  const baseline = Math.min(1, Math.max(0, Number(baselineConversionProbability || 0)));
  const mode = String(policy || "ASSISTED").toUpperCase();
  if (mode === "CONTROLLED_TEST") {
    const control = Number(context.controlConversionProbability);
    const treatment = Number(context.treatmentConversionProbability);
    if (!Number.isFinite(control) || !Number.isFinite(treatment) || treatment <= 0) return Object.assign({}, o, { attributionStatus: "NONE", attributableRevenueKZT: 0, attributableGrossProfitKZT: 0, reason: "CONTROL_DATA_REQUIRED" });
    const uplift = Math.max(0, Math.min(treatment, treatment - control));
    const share = uplift / treatment;
    return Object.assign({}, o, { attributionStatus: share > 0 ? "ATTRIBUTED" : "NONE", incrementalShare: share, attributableRevenueKZT: Math.round(o.revenueKZT * share), attributableGrossProfitKZT: Math.round(o.realizedGrossProfitKZT * share), reason: share > 0 ? "CONTROL_TREATMENT_UPLIFT" : "NO_MEASURED_UPLIFT", controlConversionProbability: control, treatmentConversionProbability: treatment });
  }
  const share = mode === "LAST_TOUCH" ? 1 : Math.max(0, 1 - baseline);
  return Object.assign({}, o, { attributionStatus: share > 0 ? "ATTRIBUTED" : "NONE", incrementalShare: share, attributableRevenueKZT: Math.round(o.revenueKZT * share), attributableGrossProfitKZT: Math.round(o.realizedGrossProfitKZT * share) });
}

module.exports = { normalizeOutcome, evaluateAttribution };
