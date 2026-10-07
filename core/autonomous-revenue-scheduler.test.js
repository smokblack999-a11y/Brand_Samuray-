"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const scheduler = require("./autonomous-revenue-scheduler");

test("Scheduler remains disabled by default", () => {
  const old = process.env.REVENUE_AUTONOMOUS_SCHEDULER_ENABLED;
  delete process.env.REVENUE_AUTONOMOUS_SCHEDULER_ENABLED;
  assert.equal(scheduler.schedulerConfig().enabled, false);
  assert.equal(scheduler.start({ tenantId: "test" }).started, false);
  if (old == null) delete process.env.REVENUE_AUTONOMOUS_SCHEDULER_ENABLED;
  else process.env.REVENUE_AUTONOMOUS_SCHEDULER_ENABLED = old;
});

test("Scheduler enforces a safe minimum interval", () => {
  const old = process.env.REVENUE_AUTONOMOUS_INTERVAL_MS;
  process.env.REVENUE_AUTONOMOUS_INTERVAL_MS = "100";
  assert.equal(scheduler.schedulerConfig().intervalMs, 5 * 60 * 1000);
  if (old == null) delete process.env.REVENUE_AUTONOMOUS_INTERVAL_MS;
  else process.env.REVENUE_AUTONOMOUS_INTERVAL_MS = old;
});
