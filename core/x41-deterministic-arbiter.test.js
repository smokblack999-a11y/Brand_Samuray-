"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DECISION, LEVEL, REASONS, evaluateClaim } = require("./x41-deterministic-arbiter");

const now = new Date("2026-10-05T08:00:00.000Z");
const policy = Object.freeze({
  activePolicyVersion: 3,
  staleDataWindowMs: 10_000,
  maxLossLimit: 50,
  dailyLossBudget: 200,
  currentDailyLoss: 150,
  maxCapitalReq: 100,
  maxKellyFraction: 0.25,
  riskPenalty: 0.5,
  requireEvidence: true
});

function claim(overrides = {}) {
  return {
    id: "claim-001",
    expectedProfit: 120,
    maxLoss: 40,
    capitalReq: 80,
    probability: 0.80,
    confidence: 0.90,
    riskScore: 0.10,
    dataTimestamp: new Date(now),
    policyVersion: 3,
    evidence: ["fresh-source"],
    ...overrides
  };
}

test("X41 executes only when every deterministic policy check passes", () => {
  const result = evaluateClaim(claim(), policy, now);
  assert.equal(result.decision, DECISION.EXECUTE);
  assert.equal(result.vetoLevel, LEVEL.GREEN);
  assert.equal(result.reason, REASONS.ALL_CHECKS_PASSED);
  assert.ok(result.riskAdjustedKellyRisk > 0);
  assert.ok(result.riskAdjustedKellyRisk <= 50);
});

test("X41 hard-vetoes stale data", () => {
  const result = evaluateClaim(claim({
    dataTimestamp: new Date(now.getTime() - 10_001)
  }), policy, now);
  assert.deepEqual(
    { decision: result.decision, reason: result.reason, level: result.vetoLevel },
    { decision: DECISION.VETO, reason: REASONS.STALE_DATA, level: LEVEL.RED }
  );
});

test("X41 hard-vetoes high-risk claim even when expected profit is attractive", () => {
  const result = evaluateClaim(claim({ maxLoss: 60, expectedProfit: 500 }), policy, now);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASONS.MAX_LOSS_EXCEEDED);
});

test("X41 blocks when remaining daily loss budget is insufficient", () => {
  const result = evaluateClaim(claim({ maxLoss: 40 }), policy, now);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASONS.DAILY_LOSS_BUDGET_EXHAUSTED);
  assert.equal(result.vetoLevel, LEVEL.BLACK);
});

test("X41 rejects policy-version drift", () => {
  const result = evaluateClaim(claim({ policyVersion: 2 }), policy, now);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASONS.MISMATCHED_POLICY_VERSION);
});

test("X41 rejects missing evidence when policy requires it", () => {
  const result = evaluateClaim(claim({ evidence: [] }), policy, now);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASONS.EVIDENCE_REQUIRED);
});

test("X41 rejects non-positive economic edge", () => {
  const result = evaluateClaim(claim({ probability: 0.20 }), policy, now);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASONS.NON_POSITIVE_EDGE);
});

test("X41 never returns EXECUTE with a non-positive risk budget", () => {
  const result = evaluateClaim(claim(), { ...policy, currentDailyLoss: 200 }, now);
  assert.equal(result.decision, DECISION.VETO);
  assert.equal(result.reason, REASONS.DAILY_LOSS_BUDGET_EXHAUSTED);
});
