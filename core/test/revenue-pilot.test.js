"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePilotEconomics } = require("../revenue-pilot");

const sample = {
  currency: "USD",
  baseline: { monthlyLeads: 100, qualifiedLeadRatePct: 20, closeRatePct: 10, adminHoursPerMonth: 20 },
  pilot: { monthlyLeads: 100, qualifiedLeadRatePct: 25, closeRatePct: 12, adminHoursPerMonth: 12 },
  grossProfitPerSale: 400,
  monthlyServiceFee: 149,
  oneTimeSetupFee: 300,
  monthlyOperatingCost: 20,
  adminHourlyCost: 20,
  evidenceWindowDays: 14
};

test("calculates before/after estimates and monthly net benefit", () => {
  const result = evaluatePilotEconomics(sample);
  assert.equal(result.currency, "USD");
  assert.equal(result.estimates.baselineSalesPerMonth, 2);
  assert.equal(result.estimates.pilotSalesPerMonth, 3);
  assert.equal(result.estimates.incrementalGrossProfitPerMonth, 400);
  assert.equal(result.estimates.adminHoursSavedPerMonth, 8);
  assert.equal(result.estimates.adminTimeValuePerMonth, 160);
  assert.equal(result.estimates.monthlyNetBenefit, 391);
  assert.equal(result.interpretation, "ESTIMATED_POSITIVE_UNIT_ECONOMICS");
  assert.ok(result.limitations.length >= 3);
});

test("does not claim positive economics when costs exceed estimated benefits", () => {
  const result = evaluatePilotEconomics({ ...sample, monthlyServiceFee: 1000, monthlyOperatingCost: 500 });
  assert.equal(result.interpretation, "POSITIVE_UNIT_ECONOMICS_NOT_DEMONSTRATED");
  assert.equal(result.estimates.paybackMonths, null);
});

test("rejects invalid percentages", () => {
  assert.throws(
    () => evaluatePilotEconomics({ ...sample, pilot: { ...sample.pilot, closeRatePct: 120 } }),
    error => error.code === "INVALID_METRIC"
  );
});

test("rejects invalid currency and missing periods", () => {
  assert.throws(() => evaluatePilotEconomics({ ...sample, currency: "dollars" }), /currency/);
  assert.throws(() => evaluatePilotEconomics({ ...sample, baseline: null }), /baseline/);
});

test("allows zero gross profit without division by zero", () => {
  const result = evaluatePilotEconomics({ ...sample, grossProfitPerSale: 0 });
  assert.equal(result.estimates.breakEvenAdditionalSalesPerMonth, null);
});
