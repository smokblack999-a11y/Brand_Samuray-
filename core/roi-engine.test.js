"use strict";

const assert = require("assert");
const { calculateROI } = require("./roi-engine");

test("ROI uses incremental revenue rather than total revenue", () => {
  const result = calculateROI({ monthlyLeads: 100, conversionBefore: 0.05, conversionAfter: 0.08, averageOrderValue: 1000, monthlyCost: 500 });
  assert.equal(result.baselineRevenue, 5000);
  assert.equal(result.projectedRevenue, 8000);
  assert.equal(result.incrementalRevenue, 3000);
  assert.equal(result.netGain, 2500);
  assert.equal(result.roiPercent, 500);
});

test("invalid numeric inputs fail safely to bounded values", () => {
  const result = calculateROI({ monthlyLeads: -1, conversionBefore: 3, conversionAfter: -2, averageOrderValue: "x", monthlyCost: 0 });
  assert.equal(result.monthlyLeads, 0);
  assert.equal(result.conversionBefore, 1);
  assert.equal(result.conversionAfter, 0);
  assert.equal(result.averageOrderValue, 0);
  assert.equal(result.roiPercent, null);
});
