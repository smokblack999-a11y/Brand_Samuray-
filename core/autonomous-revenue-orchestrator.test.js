"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildActionPlan, config } = require("./autonomous-revenue-orchestrator");

test("autonomous revenue planner stays approval-only by default", () => {
  const old = {
    enabled: process.env.REVENUE_AUTONOMOUS_CYCLE_ENABLED,
    outreach: process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED,
    sequence: process.env.APOLLO_AUTONOMOUS_SEQUENCE_ID,
    account: process.env.APOLLO_AUTONOMOUS_EMAIL_ACCOUNT_ID
  };
  delete process.env.REVENUE_AUTONOMOUS_CYCLE_ENABLED;
  delete process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED;
  delete process.env.APOLLO_AUTONOMOUS_SEQUENCE_ID;
  delete process.env.APOLLO_AUTONOMOUS_EMAIL_ACCOUNT_ID;

  const c = config();
  const plan = buildActionPlan({
    lead: { email: "ceo@example.com" },
    qualification: { score: 90 },
    decision: { action: "RESPOND" }
  }, c);

  assert.equal(plan.status, "READY_FOR_APPROVAL");
  assert.equal(plan.reason, "OUTREACH_KILL_SWITCH_OFF");

  for (const [key, value] of Object.entries({
    REVENUE_AUTONOMOUS_CYCLE_ENABLED: old.enabled,
    APOLLO_AUTONOMOUS_OUTREACH_ENABLED: old.outreach,
    APOLLO_AUTONOMOUS_SEQUENCE_ID: old.sequence,
    APOLLO_AUTONOMOUS_EMAIL_ACCOUNT_ID: old.account
  })) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

test("planner blocks weak leads", () => {
  const plan = buildActionPlan({
    lead: { email: "person@example.com" },
    qualification: { score: 45 },
    decision: { action: "RESPOND" }
  }, { minLeadScore: 70, outreachEnabled: true, sequenceIdConfigured: true, emailAccountConfigured: true });

  assert.equal(plan.status, "DO_NOT_EXECUTE");
  assert.equal(plan.reason, "NOT_READY");
});
