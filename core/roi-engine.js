"use strict";

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateROI(input = {}) {
  const monthlyLeads = Math.max(0, number(input.monthlyLeads));
  const conversionBefore = Math.max(0, Math.min(1, number(input.conversionBefore)));
  const conversionAfter = Math.max(0, Math.min(1, number(input.conversionAfter)));
  const averageOrderValue = Math.max(0, number(input.averageOrderValue));
  const monthlyCost = Math.max(0, number(input.monthlyCost));
  const baselineRevenue = monthlyLeads * conversionBefore * averageOrderValue;
  const projectedRevenue = monthlyLeads * conversionAfter * averageOrderValue;
  const incrementalRevenue = Math.max(0, projectedRevenue - baselineRevenue);
  const netGain = incrementalRevenue - monthlyCost;
  const roiPercent = monthlyCost > 0 ? Math.round((netGain / monthlyCost) * 100) : null;

  return {
    monthlyLeads,
    conversionBefore,
    conversionAfter,
    averageOrderValue,
    monthlyCost,
    baselineRevenue,
    projectedRevenue,
    incrementalRevenue,
    netGain,
    roiPercent,
    conservative: true,
    disclaimer: "Projection only. Replace assumptions with measured customer data before using as a case study."
  };
}

module.exports = { calculateROI };
