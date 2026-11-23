"use strict";

const { paymentError } = require("./provider-contract");
const { createDeliveryWebhookHandlers } = require("./delivery-webhook-handlers");
const { createSaasWebhookHandlers } = require("./saas-webhook-handlers");

function createPaymentWebhookHandlers({ provider, ledger, onDeliveryPaid, onDeliveryFailed, onSubscriptionStatusChange } = {}) {
  if (!provider || typeof provider.retrieveSubscription !== "function") {
    throw paymentError("PAYMENT_SUBSCRIPTION_LOOKUP_REQUIRED", "Payment provider must support canonical subscription retrieval");
  }
  const delivery = createDeliveryWebhookHandlers({ ledger, onPaid: onDeliveryPaid, onFailed: onDeliveryFailed });
  const saas = typeof onSubscriptionStatusChange === "function"
    ? createSaasWebhookHandlers({
        ledger,
        getCurrentSubscription: id => provider.retrieveSubscription(id),
        onStatusChange: onSubscriptionStatusChange
      })
    : null;

  return Object.freeze({
    "checkout.session.completed": async (session, event) => {
      if (session.mode === "payment") return delivery["checkout.session.completed"](session, event);
      if (session.mode === "subscription" && saas) return saas["checkout.session.completed"](session, event);
      throw paymentError("PAYMENT_CHECKOUT_MODE_UNSUPPORTED", "Checkout Session mode is not configured");
    },
    "checkout.session.async_payment_succeeded": delivery["checkout.session.async_payment_succeeded"],
    "checkout.session.async_payment_failed": delivery["checkout.session.async_payment_failed"],
    "checkout.session.expired": delivery["checkout.session.expired"],
    ...(saas ? {
      "customer.subscription.created": saas["customer.subscription.created"],
      "invoice.paid": saas["invoice.paid"],
      "invoice.payment_failed": saas["invoice.payment_failed"],
      "customer.subscription.updated": saas["customer.subscription.updated"],
      "customer.subscription.deleted": saas["customer.subscription.deleted"]
    } : {})
  });
}

module.exports = { createPaymentWebhookHandlers };
