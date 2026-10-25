"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stripeWebhookFailureStatus, PERMANENT_STRIPE_EVENT_CODES } = require("../stripe-webhook-policy");

test("permanent signed-event validation failures return 400 and are not retried forever", () => {
  for (const code of PERMANENT_STRIPE_EVENT_CODES) {
    assert.equal(stripeWebhookFailureStatus({ code }), 400, code);
  }
});

test("unknown, filesystem, and transient failures return retryable 500", () => {
  for (const error of [
    new Error("disk full"),
    Object.assign(new Error("disk full"), { code: "ENOSPC" }),
    Object.assign(new Error("I/O error"), { code: "EIO" }),
    Object.assign(new Error("network timeout"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("storage lock unavailable"), { code: "STORE_BUSY" })
  ]) {
    assert.equal(stripeWebhookFailureStatus(error), 500, error.code || error.message);
  }
});
