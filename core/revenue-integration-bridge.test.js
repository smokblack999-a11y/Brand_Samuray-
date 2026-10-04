"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bridge = require("./revenue-integration-bridge");

test("provider bridge is disabled by default", () => {
  const previous = process.env.REVENUE_INTEGRATIONS_ENABLED;
  delete process.env.REVENUE_INTEGRATIONS_ENABLED;
  const result = bridge.providerConfig();
  assert.equal(result.enabled, false);
  if (previous === undefined) delete process.env.REVENUE_INTEGRATIONS_ENABLED;
  else process.env.REVENUE_INTEGRATIONS_ENABLED = previous;
});

test("Stripe checkout fails closed without redirect configuration", async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "test";
  delete process.env.STRIPE_SUCCESS_URL;
  delete process.env.STRIPE_CANCEL_URL;
  await assert.rejects(
    () => bridge.createStripeCheckout({ amountMinor: 1000 }),
    error => error.code === "STRIPE_REDIRECTS_REQUIRED"
  );
  if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = previous;
});
