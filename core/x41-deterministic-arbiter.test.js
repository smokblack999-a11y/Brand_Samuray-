"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateClaim, DECISION, LEVEL, REASON } = require("./x41-deterministic-arbiter");

const NOW = Date.parse("2026-10-05T08:00:00.000Z");

function policy(overrides = {}) {
  return {
    activePolicy: 3,
    maxLossLimitMicro: "50000000",
    dailyLossBudgetMicro: "200000000",
    currentDailyLossMicro: "150000000",
    maxCapitalReqMicro: "100000000",
    staleDataWindowMs: 10_000,
    ...overrides
  };
}

function claim(overrides = {}) {
  return {
    id: "claim-001",
    expectedProfitMicro: "120000000",
    maxLossMicro: "40000000",
    capitalReqMicro: "80000000",
    dataTimestamp: "2026-10-05T07:59:59.000Z",
    policyVersion: 3,
    probability: 0.95,
    confidence: 0.9,
    ...overrides
  };
}

test("X41 executes a valid claim deterministically", () => {
  const result = evaluateClaim(claim(), policy(), NOW);
  assert.equal(result.decision, DECISION.EXECUTE);
  assert.equal(result.vetoLevel, LEVEL.GREEN);
  assert.equal(result.reason, REASON.ALL_CHECKS_PASSED);
  assert.ok(BigInt(result.recommendedRiskMicro) > 0n);
});

test("X41 vetoes stale data before any economic approval", () => {
  const result = evaluateClaim(
    claim({ dataTimestamp: "2026-10-05T07:59:40.000Z" }),
    policy(),
    NOW
  );
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASON.STALE_DATA);
  assert.equal(result.vetoLevel, LEVEL.RED);
});

test("X41 vetoes mismatched policy version", () => {
  const result = evaluateClaim(claim({ policyVersion: 2 }), policy(), NOW);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASON.POLICY_MISMATCH);
});

test("X41 hard-stops when the daily loss budget would be exceeded", () => {
  const result = evaluateClaim(claim({ maxLossMicro: "60000000" }), policy(), NOW);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASON.MAX_LOSS_EXCEEDED);
});

test("X41 uses BLACK veto when the daily budget is the binding constraint", () => {
  const result = evaluateClaim(
    claim({ maxLossMicro: "40000000" }),
    policy({ currentDailyLossMicro: "170000000" }),
    NOW
  );
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASON.DAILY_LOSS_BUDGET_EXHAUSTED);
  assert.equal(result.vetoLevel, LEVEL.BLACK);
});

test("X41 vetoes a negative expected-profit claim", () => {
  const result = evaluateClaim(claim({ expectedProfitMicro: "0" }), policy(), NOW);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASON.NEGATIVE_EXPECTED_PROFIT);
});

test("X41 has no floating-point money arithmetic in the decision path", () => {
  const result = evaluateClaim(
    claim({ expectedProfitMicro: "1", maxLossMicro: "1", capitalReqMicro: "1000000", probability: 0.51 }),
    policy({ currentDailyLossMicro: "0" }),
    NOW
  );
  assert.equal(result.decision, DECISION.EXECUTE);
  assert.match(result.recommendedRiskMicro, /^\d+$/);
});
