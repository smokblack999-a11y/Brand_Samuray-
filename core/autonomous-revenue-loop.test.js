"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("autonomous revenue loop exposes the complete economic stages", () => {
  const loop = require("./autonomous-revenue-loop");
  assert.deepEqual([...loop.FINAL_OUTCOMES].sort(), ["CANCELLED", "LOST", "REFUNDED", "WON"]);
  assert.equal(typeof loop.evaluateLead, "function");
  assert.equal(typeof loop.recordExecution, "function");
  assert.equal(typeof loop.recordOutcome, "function");
  assert.equal(typeof loop.recordPayment, "function");
  assert.equal(typeof loop.snapshot, "function");
});

test("outcome status is fail-closed", async () => {
  const loop = require("./autonomous-revenue-loop");
  await assert.rejects(
    loop.recordOutcome({ tenantId: "t1", eventId: "e1", status: "MAYBE" }),
    error => error && error.code === "INVALID_OUTCOME_STATUS"
  );
});


test("payment adapter is fail-closed",()=>{
  const loop = require("./autonomous-revenue-loop");
  assert.throws(
    () => loop.recordPayment({ tenantId:"t1", paymentId:"p1", amountKZT:0 }),
    error => error && error.code === "INVALID_PAYMENT_AMOUNT"
  );
});
