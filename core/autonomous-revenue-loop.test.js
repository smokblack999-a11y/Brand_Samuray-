"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("autonomous revenue loop exposes the complete economic stages", () => {
  const loop = require("./autonomous-revenue-loop");
  assert.deepEqual([...loop.FINAL_OUTCOMES].sort(), ["CANCELLED", "LOST", "REFUNDED", "WON"]);
  assert.equal(typeof loop.evaluateLead, "function");
  assert.equal(typeof loop.recordExecution, "function");
  assert.equal(typeof loop.recordOutcome, "function");
  assert.equal(typeof loop.snapshot, "function");
});

test("outcome status is fail-closed", () => {
  const loop = require("./autonomous-revenue-loop");
  assert.throws(
    () => loop.recordOutcome({ tenantId: "t1", eventId: "e1", status: "MAYBE" }),
    error => error && error.code === "INVALID_OUTCOME_STATUS"
  );
});
