"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const gate = require("./revenue-execution-gate");

function plan() {
  return {
    lead: { email: "ceo@example.com", apolloPersonId: "person-1" },
    decision: { decisionId: "decision-1", action: "RESPOND" },
    opportunity: {
      tenantId: "pilot",
      opportunityId: "opp-1",
      expectedGrossProfitKZT: 50000,
      expectedExecutionCostKZT: 1000,
      purchaseProbability: 0.8,
      confidence: 0.8
    },
    allocation: { allocationKZT: 1000 },
    actionPlan: { status: "READY_FOR_EXECUTION" }
  };
}

test("execution gate rejects when X33 is disabled", async () => {
  const old = {
    x33: process.env.X33_ENABLED,
    exec: process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED,
    outreach: process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED
  };
  process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED = "true";
  process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED = "true";
  delete process.env.X33_ENABLED;
  const result = await gate.authorizePlan(plan());
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "X33_DISABLED");
  for (const [k,v] of Object.entries(old)) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
});

test("execution gate rejects an incomplete economic claim", async () => {
  const p = plan();
  delete p.opportunity.purchaseProbability;
  const result = await gate.authorizePlan(p);
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "EXECUTION_GATE_EVIDENCE_INCOMPLETE");
});

test("execution gate issues authorization only after X33 reservation", async () => {
  const old = {
    x33: process.env.X33_ENABLED,
    exec: process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED,
    outreach: process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED
  };
  process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED = "true";
  process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED = "true";
  process.env.X33_ENABLED = "true";

  const fakeX33 = {
    enabled: () => true,
    authorize: async input => ({
      enabled: true,
      authorized: true,
      reservation: { reservationId: "reservation-1", eventId: input.eventId }
    })
  };

  const result = await gate.authorizePlan(plan(), { x33Service: fakeX33, nowMs: Date.parse("2026-10-08T00:00:00Z") });
  assert.equal(result.authorized, true);
  assert.equal(result.authorization.gateDecision, "EXECUTE");
  assert.equal(result.authorization.reservationId, "reservation-1");
  assert.equal(gate.assertAuthorization(result.authorization), true);

  for (const [k,v] of Object.entries(old)) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
});

test("forged plain authorization object is rejected", () => {
  assert.throws(
    () => gate.assertAuthorization({
      decisionId: "decision-1",
      reservationId: "reservation-1",
      gateDecision: "EXECUTE",
      reserved: true
    }),
    /EXECUTION_AUTHORIZATION_REQUIRED/
  );
});
