"use strict";

const { createPaymentProviderRegistry, readPaymentConfig } = require("./provider-registry");
const { paymentError } = require("./provider-contract");

function createPaymentRuntime({ env = process.env, StripeClient } = {}) {
  const config = readPaymentConfig(env);
  const providers = {};

  if (config.enabled && config.provider === "stripe_test") {
    const apiKey = String(env.STRIPE_SECRET_KEY || "").trim();
    const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
    if (!apiKey || !webhookSecret) {
      throw paymentError("STRIPE_TEST_CONFIG_INCOMPLETE", "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when Stripe test payments are enabled");
    }
    const Stripe = StripeClient || require("stripe");
    const { createStripeTestProvider } = require("./stripe-test-provider");
    providers.stripe_test = createStripeTestProvider({ StripeClient: Stripe, apiKey, webhookSecret });
  }

  const registry = createPaymentProviderRegistry({ env, providers });
  return Object.freeze({
    config: Object.freeze({ ...config }),
    registry,
    health() {
      return {
        ...registry.getStatus(),
        adapter: config.enabled && config.provider === "stripe_test" ? "loaded" : "not_loaded"
      };
    }
  });
}

module.exports = { createPaymentRuntime };
