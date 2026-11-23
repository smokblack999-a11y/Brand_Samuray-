"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REQUIRED_METHODS,
  assertPaymentProvider,
  readPaymentConfig,
  createPaymentProviderRegistry
} = require("../payments");

function provider(name = "stripe_test") {
  return {
    name,
    async createOneTimeCheckout() {},
    async createSubscriptionCheckout() {},
    async verifyWebhook() {},
    async parseWebhook() {},
    async refund() {},
    async health() { return { ok: true, mode: "test" }; }
  };
}

test("payment provider contract requires all operations", () => {
  assert.equal(REQUIRED_METHODS.length, 6);
  assert.equal(assertPaymentProvider(provider()).name, "stripe_test");
  assert.throws(
    () => assertPaymentProvider({ name: "stripe_test" }),
    error => error.code === "PAYMENT_PROVIDER_CONTRACT_INVALID"
  );
});

test("payment config is disabled by default", () => {
  const config = readPaymentConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.provider, "disabled");
});

test("test mode only enables explicitly allowlisted providers", () => {
  const config = readPaymentConfig({
    NODE_ENV: "development",
    PAYMENTS_ENABLED: "true",
    PAYMENTS_MODE: "test",
    PAYMENTS_PROVIDER: "stripe_test"
  });
  assert.equal(config.enabled, true);
  assert.equal(config.blockedReason, null);
});

test("production never enables test mode", () => {
  const config = readPaymentConfig({
    NODE_ENV: "production",
    PAYMENTS_ENABLED: "true",
    PAYMENTS_MODE: "test",
    PAYMENTS_PROVIDER: "stripe_test"
  });
  assert.equal(config.enabled, false);
  assert.equal(config.blockedReason, "test_mode_forbidden_in_production");
});

test("live mode is explicitly blocked", () => {
  const config = readPaymentConfig({
    NODE_ENV: "development",
    PAYMENTS_ENABLED: "true",
    PAYMENTS_MODE: "live",
    PAYMENTS_PROVIDER: "stripe_test"
  });
  assert.equal(config.enabled, false);
  assert.equal(config.blockedReason, "live_mode_not_implemented");
});

test("registry rejects missing provider implementation", () => {
  const registry = createPaymentProviderRegistry({
    env: { PAYMENTS_ENABLED: "true", PAYMENTS_MODE: "test", PAYMENTS_PROVIDER: "local_test" },
    providers: {}
  });
  assert.throws(() => registry.getProvider(), error => error.code === "PAYMENT_PROVIDER_UNAVAILABLE");
});

test("registry returns a contract-checked provider", () => {
  const registry = createPaymentProviderRegistry({
    env: { PAYMENTS_ENABLED: "true", PAYMENTS_MODE: "test", PAYMENTS_PROVIDER: "stripe_test" },
    providers: { stripe_test: provider() }
  });
  assert.equal(registry.getProvider().name, "stripe_test");
});

test("registry refuses to resolve provider while disabled", () => {
  const registry = createPaymentProviderRegistry({ env: {}, providers: { stripe_test: provider() } });
  assert.throws(() => registry.getProvider(), error => error.code === "PAYMENTS_DISABLED");
});
