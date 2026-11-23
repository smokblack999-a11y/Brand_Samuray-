"use strict";

const { paymentError } = require("./provider-contract");

function objectId(value, prefix, field) {
  const id = typeof value === "string" ? value : value && typeof value.id === "string" ? value.id : "";
  if (!id.startsWith(prefix)) throw paymentError("PAYMENT_SUBSCRIPTION_EVENT_INVALID", field + " is missing or invalid");
  return id;
}

function createSaasWebhookHandlers({ ledger, onStatusChange } = {}) {
  if (!ledger || typeof ledger.createSubscription !== "function" ||
      typeof ledger.getSubscriptionByProviderId !== "function" ||
      typeof ledger.setSubscriptionStatus !== "function") {
    throw paymentError("PAYMENT_LEDGER_INVALID", "SaaS webhook handlers require subscription ledger support");
  }
  if (typeof onStatusChange !== "function") {
    throw paymentError("PAYMENT_SUBSCRIPTION_HANDLER_REQUIRED", "An idempotent subscription status handler is required");
  }

  async function change(providerSubscriptionId, status, providerCustomerId, event) {
    const current = ledger.getSubscriptionByProviderId(providerSubscriptionId);
    if (!current) throw paymentError("PAYMENT_LEDGER_SUBSCRIPTION_NOT_FOUND", "Stripe subscription is not linked to a SAMURAI customer");
    if (providerCustomerId && current.providerCustomerId && providerCustomerId !== current.providerCustomerId) {
      throw paymentError("PAYMENT_SUBSCRIPTION_CUSTOMER_MISMATCH", "Stripe customer does not match the recorded subscription");
    }
    const updated = ledger.setSubscriptionStatus(providerSubscriptionId, status, providerCustomerId);
    await onStatusChange(updated, event);
  }

  function stripeStatus(value) {
    const mapping = {
      incomplete: "incomplete",
      incomplete_expired: "canceled",
      trialing: "trialing",
      active: "active",
      past_due: "past_due",
      unpaid: "unpaid",
      canceled: "canceled",
      paused: "paused"
    };
    const status = mapping[value];
    if (!status) throw paymentError("PAYMENT_SUBSCRIPTION_STATUS_UNSUPPORTED", "Stripe subscription status is not supported");
    return status;
  }

  return Object.freeze({
    "checkout.session.completed": async (session, event) => {
      if (session.mode !== "subscription") return;
      const metadata = session.metadata || {};
      if (metadata.samurai_flow !== "saas") throw paymentError("PAYMENT_SUBSCRIPTION_METADATA_INVALID", "SaaS Checkout metadata is missing");
      const customerId = metadata.samurai_customer_id;
      const planId = metadata.samurai_plan_id;
      if (typeof customerId !== "string" || !customerId || typeof planId !== "string" || !planId) {
        throw paymentError("PAYMENT_SUBSCRIPTION_METADATA_INVALID", "Internal customer or plan reference is missing");
      }
      const providerSubscriptionId = objectId(session.subscription, "sub_", "subscription");
      const providerCustomerId = objectId(session.customer, "cus_", "customer");
      const existing = ledger.getSubscriptionByProviderId(providerSubscriptionId);
      if (existing) {
        if (existing.customerId !== customerId || existing.planId !== planId) {
          throw paymentError("PAYMENT_SUBSCRIPTION_MISMATCH", "Existing subscription does not match Checkout metadata");
        }
        return;
      }
      const record = ledger.createSubscription({
        subscriptionId: "subscription_" + providerSubscriptionId,
        customerId,
        planId,
        provider: "stripe_test",
        providerSubscriptionId,
        providerCustomerId,
        status: "pending"
      });
      await onStatusChange(record, event);
    },

    "invoice.paid": async (invoice, event) => {
      const subscriptionId = objectId(invoice.subscription, "sub_", "invoice.subscription");
      const customerId = objectId(invoice.customer, "cus_", "invoice.customer");
      await change(subscriptionId, "active", customerId, event);
    },

    "invoice.payment_failed": async (invoice, event) => {
      const subscriptionId = objectId(invoice.subscription, "sub_", "invoice.subscription");
      const customerId = objectId(invoice.customer, "cus_", "invoice.customer");
      await change(subscriptionId, "past_due", customerId, event);
    },

    "customer.subscription.updated": async (subscription, event) => {
      const subscriptionId = objectId(subscription.id, "sub_", "subscription.id");
      const customerId = objectId(subscription.customer, "cus_", "subscription.customer");
      await change(subscriptionId, stripeStatus(subscription.status), customerId, event);
    },

    "customer.subscription.deleted": async (subscription, event) => {
      const subscriptionId = objectId(subscription.id, "sub_", "subscription.id");
      const customerId = objectId(subscription.customer, "cus_", "subscription.customer");
      await change(subscriptionId, "canceled", customerId, event);
    }
  });
}

module.exports = { createSaasWebhookHandlers };
