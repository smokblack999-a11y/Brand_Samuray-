"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentRuntime } = require("../payments/runtime");

class FakeStripe {
  constructor(key, options) {
    this.key = key;
    this.options = options;
    this.checkout = { sessions: { create: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/test" }) } };
    this.webhooks = { constructEvent: () => ({ id: "evt_test_123", type: "noop", data: { object: {} } }) };
    this.refunds = { create: async () => ({ id: "re_test_123" }) };
  }
}

test("runtime remains disabled without constructing Stripe", () => {
  const runtime = createPaymentRuntime({ env: { NODE_ENV: "test" }, StripeClient: class { constructor() { throw new Error("must not construct"); } } });
  assert.equal(runtime.health().enabled, false);
  assert.equal(runtime.health().adapter, "not_loaded");
});

test("runtime constructs the Stripe adapter only with explicit test config", () => {
  const runtime = createPaymentRuntime({
    env: {
      NODE_ENV: "test",
      PAYMENTS_ENABLED: "true",
      PAYMENTS_MODE: "test",
      PAYMENTS_PROVIDER: "stripe_test",
      STRIPE_SECRET_KEY: "sk_test_sandbox",
      STRIPE_WEBHOOK_SECRET: "whsec_sandbox"
    },
    StripeClient: FakeStripe
  });
  assert.equal(runtime.health().enabled, true);
  assert.equal(runtime.health().adapter, "loaded");
  assert.equal(runtime.registry.getProvider().name, "stripe_test");
});

test("runtime refuses incomplete Stripe test credentials", () => {
  assert.throws(() => createPaymentRuntime({
    env: {
      NODE_ENV: "test",
      PAYMENTS_ENABLED: "true",
      PAYMENTS_MODE: "test",
      PAYMENTS_PROVIDER: "stripe_test",
      STRIPE_SECRET_KEY: "sk_test_sandbox"
    },
    StripeClient: FakeStripe
  }), error => error.code === "STRIPE_TEST_CONFIG_INCOMPLETE");
});

test("runtime blocks test provider in production", () => {
  const runtime = createPaymentRuntime({
    env: {
      NODE_ENV: "production",
      PAYMENTS_ENABLED: "true",
      PAYMENTS_MODE: "test",
      PAYMENTS_PROVIDER: "stripe_test"
    },
    StripeClient: FakeStripe
  });
  assert.equal(runtime.health().enabled, false);
  assert.equal(runtime.health().blockedReason, "test_mode_forbidden_in_production");
});
