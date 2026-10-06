"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ledger = require("./revenue-ledger");
const runtime = require("./x27-runtime");

test("revenue observations persist without polluting learning calibration", () => {
  const tenant = "test-observation-" + Date.now();
  const saved = runtime.recordObservation(tenant, {
    observationId: "obs-1",
    source: "test",
    leadId: "lead-1",
    observation: "qualification_observation",
    score: 82,
    decisionAction: "RESPOND",
    planStatus: "READY_FOR_APPROVAL",
    planReason: "OUTREACH_KILL_SWITCH_OFF"
  });

  assert.equal(saved.inserted, true);
  assert.equal(runtime.list(tenant, "OBSERVATION").length, 1);
  assert.deepEqual(runtime.historicalStats(tenant), {});
});
