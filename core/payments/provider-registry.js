"use strict";

const { assertPaymentProvider, paymentError } = require("./provider-contract");

const TEST_PROVIDERS = new Set(["stripe_test", "local_test", "mock_test"]);

function readPaymentConfig(env = process.env) {
  const enabled = String(env.PAYMENTS_ENABLED || "").trim().toLowerCase() === "true";
  const mode = String(env.PAYMENTS_MODE || "disabled").trim().toLowerCase();
  const provider = String(env.PAYMENTS_PROVIDER || "disabled").trim().toLowerCase();
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";

  if (production && mode === "test") {
    return { enabled: false, mode, provider, production, blockedReason: "test_mode_forbidden_in_production" };
  }
  if (mode === "live") {
    return { enabled: false, mode, provider, production, blockedReason: "live_mode_not_implemented" };
  }
  if (mode !== "test") {
    return { enabled: false, mode, provider, production, blockedReason: "payments_mode_not_enabled" };
  }
  if (!TEST_PROVIDERS.has(provider)) {
    return { enabled: false, mode, provider, production, blockedReason: "provider_not_allowlisted_for_test_mode" };
  }
  if (!enabled) {
    return { enabled: false, mode, provider, production, blockedReason: "payments_feature_disabled" };
  }
  return { enabled: true, mode, provider, production, blockedReason: null };
}

function createPaymentProviderRegistry({ env = process.env, providers = {} } = {}) {
  const config = readPaymentConfig(env);

  function getStatus() {
    return {
      enabled: config.enabled,
      mode: config.mode,
      provider: config.provider,
      production: config.production,
      blockedReason: config.blockedReason
    };
  }

  function getProvider() {
    if (!config.enabled) {
      throw paymentError("PAYMENTS_DISABLED", "Payments are disabled by configuration");
    }
    const provider = providers[config.provider];
    if (!provider) {
      throw paymentError("PAYMENT_PROVIDER_UNAVAILABLE", "Configured payment provider is not installed");
    }
    return assertPaymentProvider(provider, config.provider);
  }

  return Object.freeze({ getStatus, getProvider });
}

module.exports = { TEST_PROVIDERS, readPaymentConfig, createPaymentProviderRegistry };
