"use strict";

const REQUIRED_METHODS = Object.freeze([
  "createOneTimeCheckout",
  "createSubscriptionCheckout",
  "verifyWebhook",
  "parseWebhook",
  "refund",
  "health"
]);

function paymentError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertPaymentProvider(provider, expectedName) {
  if (!provider || typeof provider !== "object") {
    throw paymentError("PAYMENT_PROVIDER_INVALID", "Payment provider must be an object");
  }
  if (expectedName && provider.name !== expectedName) {
    throw paymentError("PAYMENT_PROVIDER_NAME_MISMATCH", "Payment provider name does not match its registry key");
  }
  const missing = REQUIRED_METHODS.filter(method => typeof provider[method] !== "function");
  if (missing.length) {
    throw paymentError("PAYMENT_PROVIDER_CONTRACT_INVALID", "Payment provider is missing required methods: " + missing.join(", "));
  }
  return provider;
}

module.exports = { REQUIRED_METHODS, assertPaymentProvider, paymentError };
