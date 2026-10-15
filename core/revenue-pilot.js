"use strict";

function finiteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    const error = new Error(field + " must be a number between " + min + " and " + max);
    error.code = "INVALID_METRIC";
    throw error;
  }
  return n;
}

function normalizePeriod(input, name) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error(name + " metrics are required");
    error.code = "INVALID_METRIC";
    throw error;
  }
  return {
    monthlyLeads: finiteNumber(input.monthlyLeads, name + ".monthlyLeads", { min: 0, max: 100000000 }),
    qualifiedLeadRatePct: finiteNumber(input.qualifiedLeadRatePct, name + ".qualifiedLeadRatePct", { min: 0, max: 100 }),
    closeRatePct: finiteNumber(input.closeRatePct, name + ".closeRatePct", { min: 0, max: 100 }),
    adminHoursPerMonth: finiteNumber(input.adminHoursPerMonth, name + ".adminHoursPerMonth", { min: 0, max: 744 })
  };
}

/**
 * Estimates unit economics from operator-supplied business data.
 * A before/after estimate is not proof that automation caused a change.
 */
function evaluatePilotEconomics(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error("JSON metrics object is required");
    error.code = "INVALID_METRIC";
    throw error;
  }

  const currency = String(input.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const error = new Error("currency must be a 3-letter currency code, e.g. USD");
    error.code = "INVALID_METRIC";
    throw error;
  }

  const baseline = normalizePeriod(input.baseline, "baseline");
  const pilot = normalizePeriod(input.pilot, "pilot");
  const grossProfitPerSale = finiteNumber(input.grossProfitPerSale, "grossProfitPerSale", { min: 0, max: 1000000000 });
  const monthlyServiceFee = finiteNumber(input.monthlyServiceFee, "monthlyServiceFee", { min: 0, max: 1000000000 });
  const oneTimeSetupFee = finiteNumber(input.oneTimeSetupFee == null ? 0 : input.oneTimeSetupFee, "oneTimeSetupFee", { min: 0, max: 1000000000 });
  const monthlyOperatingCost = finiteNumber(input.monthlyOperatingCost == null ? 0 : input.monthlyOperatingCost, "monthlyOperatingCost", { min: 0, max: 1000000000 });
  const evidenceWindowDays = finiteNumber(input.evidenceWindowDays == null ? 14 : input.evidenceWindowDays, "evidenceWindowDays", { min: 1, max: 365 });
  const hourlyCost = finiteNumber(input.adminHourlyCost == null ? 0 : input.adminHourlyCost, "adminHourlyCost", { min: 0, max: 1000000 });

  const baselineQualifiedLeads = baseline.monthlyLeads * baseline.qualifiedLeadRatePct / 100;
  const pilotQualifiedLeads = pilot.monthlyLeads * pilot.qualifiedLeadRatePct / 100;
  const baselineSalesEstimate = baselineQualifiedLeads * baseline.closeRatePct / 100;
  const pilotSalesEstimate = pilotQualifiedLeads * pilot.closeRatePct / 100;
  const incrementalSalesEstimate = pilotSalesEstimate - baselineSalesEstimate;
  const incrementalGrossProfit = incrementalSalesEstimate * grossProfitPerSale;
  const hoursSaved = baseline.adminHoursPerMonth - pilot.adminHoursPerMonth;
  const timeValue = hoursSaved * hourlyCost;
  const monthlyBenefitBeforeFees = incrementalGrossProfit + timeValue;
  const monthlyNetBenefit = monthlyBenefitBeforeFees - monthlyServiceFee - monthlyOperatingCost;
  const paybackMonths = monthlyNetBenefit > 0 ? oneTimeSetupFee / monthlyNetBenefit : null;
  const breakEvenSalesNeeded = grossProfitPerSale > 0
    ? Math.max(0, (monthlyServiceFee + monthlyOperatingCost - timeValue) / grossProfitPerSale)
    : null;
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;

  return {
    currency,
    evidenceWindowDays,
    estimates: {
      baselineQualifiedLeads: round(baselineQualifiedLeads),
      pilotQualifiedLeads: round(pilotQualifiedLeads),
      baselineSalesPerMonth: round(baselineSalesEstimate),
      pilotSalesPerMonth: round(pilotSalesEstimate),
      incrementalSalesPerMonth: round(incrementalSalesEstimate),
      incrementalGrossProfitPerMonth: round(incrementalGrossProfit),
      adminHoursSavedPerMonth: round(hoursSaved),
      adminTimeValuePerMonth: round(timeValue),
      monthlyBenefitBeforeFees: round(monthlyBenefitBeforeFees),
      monthlyServiceFee: round(monthlyServiceFee),
      monthlyOperatingCost: round(monthlyOperatingCost),
      monthlyNetBenefit: round(monthlyNetBenefit),
      oneTimeSetupFee: round(oneTimeSetupFee),
      paybackMonths: paybackMonths === null ? null : round(paybackMonths),
      breakEvenAdditionalSalesPerMonth: breakEvenSalesNeeded === null ? null : round(breakEvenSalesNeeded)
    },
    interpretation: monthlyNetBenefit > 0
      ? "ESTIMATED_POSITIVE_UNIT_ECONOMICS"
      : "POSITIVE_UNIT_ECONOMICS_NOT_DEMONSTRATED",
    limitations: [
      "Inputs are supplied by the operator and are not independently verified.",
      "Before/after differences do not prove the automation caused the change.",
      "Sales are fractional expected values, not guaranteed actual sales.",
      "Use a comparable baseline, annotate seasonality and campaign changes, and validate with the client before making ROI claims."
    ]
  };
}

module.exports = { evaluatePilotEconomics };
