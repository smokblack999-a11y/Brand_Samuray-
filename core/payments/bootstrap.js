"use strict";

const { paymentError } = require("./provider-contract");
const { createPaymentRuntime } = require("./runtime");
const { createPaymentLedger } = require("./ledger");
const { createStripeWebhookProcessor } = require("./webhook-processor");
const { createPaymentWebhookHandlers } = require("./combined-webhook-handlers");
const { createPaymentRouter } = require("./http-router");

function mountPaymentRoutes({
  app,
  express,
  env = process.env,
  requireApiKey,
  domainAdapter,
  checkoutRateLimit,
  runtimeFactory = createPaymentRuntime,
  ledgerFactory = createPaymentLedger
} = {}) {
  if (!app || typeof app.use !== "function") throw paymentError("PAYMENT_HTTP_APP_REQUIRED", "Express application is required");
  if (String(env.PAYMENTS_HTTP_ENABLED || "").trim().toLowerCase() !== "true") {
    return Object.freeze({ mounted: false, reason: "payments_http_disabled" });
  }
  if (!domainAdapter || typeof domainAdapter !== "object") {
    throw paymentError("PAYMENT_DOMAIN_ADAPTER_REQUIRED", "A real SAMURAI order/customer domain adapter is required");
  }
  const required = ["requireCustomerIdentity", "resolveDeliveryOrder", "onDeliveryCheckoutPreparing", "onDeliveryCheckoutCreated", "onDeliveryCheckoutFailed", "onDeliveryPaid", "onDeliveryFailed"];
  const missing = required.filter(name => typeof domainAdapter[name] !== "function");
  if (missing.length) {
    throw paymentError("PAYMENT_DOMAIN_ADAPTER_INCOMPLETE", "Payment domain adapter is missing: " + missing.join(", "));
  }

  const hasSaasResolver = typeof domainAdapter.resolveSaasPlan === "function";
  const hasSaasEntitlementHandler = typeof domainAdapter.onSubscriptionStatusChange === "function";
  if (hasSaasResolver !== hasSaasEntitlementHandler) {
    throw paymentError("PAYMENT_SAAS_ADAPTER_INCOMPLETE", "SaaS plan resolver and entitlement callback must be configured together");
  }

  const runtime = runtimeFactory({ env });
  const health = runtime.health();
  if (!health.enabled || health.mode !== "test" || health.provider !== "stripe_test") {
    throw paymentError("PAYMENTS_NOT_READY", "HTTP payment routes require explicitly enabled Stripe test mode");
  }
  const provider = runtime.registry.getProvider();
  const ledger = ledgerFactory();
  const handlers = createPaymentWebhookHandlers({
    provider,
    ledger,
    onDeliveryPaid: domainAdapter.onDeliveryPaid,
    onDeliveryFailed: domainAdapter.onDeliveryFailed,
    onSubscriptionStatusChange: domainAdapter.onSubscriptionStatusChange
  });
  const webhookProcessor = createStripeWebhookProcessor({ provider, ledger, handlers });
  const router = createPaymentRouter({
    express,
    runtime,
    ledger,
    webhookProcessor,
    requireApiKey,
    requireCustomerIdentity: domainAdapter.requireCustomerIdentity,
    onDeliveryCheckoutPreparing: domainAdapter.onDeliveryCheckoutPreparing,
    onDeliveryCheckoutCreated: domainAdapter.onDeliveryCheckoutCreated,
    onDeliveryCheckoutFailed: domainAdapter.onDeliveryCheckoutFailed,
    resolveDeliveryOrder: domainAdapter.resolveDeliveryOrder,
    resolveSaasPlan: domainAdapter.resolveSaasPlan,
    successUrl: env.PAYMENTS_SUCCESS_URL,
    cancelUrl: env.PAYMENTS_CANCEL_URL,
    checkoutRateLimit
  });
  app.use("/api/payments", router);
  return Object.freeze({ mounted: true, prefix: "/api/payments", mode: "test", provider: "stripe_test" });
}

module.exports = { mountPaymentRoutes };
