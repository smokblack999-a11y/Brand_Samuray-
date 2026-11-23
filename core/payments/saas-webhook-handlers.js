"use strict";

const { paymentError } = require("./provider-contract");

function objectId(value, prefix, field) {
  const id = typeof value === "string" ? value : value && typeof value.id === "string" ? value.id : "";
  if (!id.startsWith(prefix)) throw paymentError("PAYMENT_SUBSCRIPTION_EVENT_INVALID", field + " is missing or invalid");
  return id;
}

function createSaasWebhookHandlers({ ledger, getCurrentSubscription, onStatusChange } = {}) {
  if (!ledger || typeof ledger.createSubscription !== "function" ||
      typeof ledger.getSubscriptionByProviderId !== "function" ||
      typeof ledger.setSubscriptionStatus !== "function") {
    throw paymentError("PAYMENT_LEDGER_INVALID", "SaaS webhook handlers require subscription ledger support");
  }
  if (typeof getCurrentSubscription !== "function") {
    throw paymentError("PAYMENT_SUBSCRIPTION_LOOKUP_REQUIRED", "A canonical provider subscription lookup is required");
  }
  if (typeof onStatusChange !== "function") {
    throw paymentError("PAYMENT_SUBSCRIPTION_HANDLER_REQUIRED", "An idempotent subscription status handler is required");
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

  function validateMetadata(subscription) {
    const metadata = subscription.metadata || {};
    const customerId = metadata.samurai_customer_id;
    const planId = metadata.samurai_plan_id;
    if (metadata.samurai_flow !== "saas" || typeof customerId !== "string" || !customerId ||
        typeof planId !== "string" || !planId) {
      throw paymentError("PAYMENT_SUBSCRIPTION_METADATA_INVALID", "Canonical Stripe subscription is missing SAMURAI customer or plan metadata");
    }
    return { customerId, planId };
  }

  async function synchronize(providerSubscriptionId, expectedCustomerId, event) {
    const canonical = await getCurrentSubscription(providerSubscriptionId);
    if (!canonical || canonical.id !== providerSubscriptionId) {
      throw paymentError("PAYMENT_SUBSCRIPTION_LOOKUP_FAILED", "Canonical Stripe subscription could not be verified");
    }
    const providerCustomerId = objectId(canonical.customer, "cus_", "subscription.customer");
    if (expectedCustomerId && expectedCustomerId !== providerCustomerId) {
      throw paymentError("PAYMENT_SUBSCRIPTION_CUSTOMER_MISMATCH", "Webhook customer does not match the current Stripe subscription");
    }
    const { customerId, planId } = validateMetadata(canonical);
    const status = stripeStatus(canonical.status);
    let current = ledger.getSubscriptionByProviderId(providerSubscriptionId);

    if (!current) {
      const record = ledger.createSubscription({
        subscriptionId: "subscription_" + providerSubscriptionId,
        customerId,
        planId,
        provider: "stripe_test",
        providerSubscriptionId,
        providerCustomerId,
        status
      });
      await onStatusChange(record, event);
      return record;
    }

    if (current.customerId !== customerId || current.planId !== planId ||
        (current.providerCustomerId && current.providerCustomerId !== providerCustomerId)) {
      throw paymentError("PAYMENT_SUBSCRIPTION_MISMATCH", "Canonical Stripe subscription does not match the linked SAMURAI customer and plan");
    }
    if (current.status === status) return current;

    const updated = ledger.setSubscriptionStatus(providerSubscriptionId, status, providerCustomerId);
    await onStatusChange(updated, event);
    return updated;
  }

  async function syncFromObjectId(value, expectedCustomer, event, field) {
    const id = objectId(value, "sub_", field);
    const customerId = expectedCustomer ? objectId(expectedCustomer, "cus_", "event.customer") : null;
    return synchronize(id, customerId, event);
  }

  return Object.freeze({
    "checkout.session.completed": async (session, event) => {
      if (session.mode !== "subscription") return;
      const providerSubscriptionId = objectId(session.subscription, "sub_", "subscription");
      const expectedCustomer = objectId(session.customer, "cus_", "customer");
      return synchronize(providerSubscriptionId, expectedCustomer, event);
    },

    "customer.subscription.created": async (subscription, event) => {
      const id = objectId(subscription.id, "sub_", "subscription.id");
      return synchronize(id, objectId(subscription.customer, "cus_", "subscription.customer"), event);
    },

    "invoice.paid": async (invoice, event) =>
      syncFromObjectId(invoice.subscription, invoice.customer, event, "invoice.subscription"),

    "invoice.payment_failed": async (invoice, event) =>
      syncFromObjectId(invoice.subscription, invoice.customer, event, "invoice.subscription"),

    "customer.subscription.updated": async (subscription, event) => {
      const id = objectId(subscription.id, "sub_", "subscription.id");
      return synchronize(id, objectId(subscription.customer, "cus_", "subscription.customer"), event);
    },

    "customer.subscription.deleted": async (subscription, event) => {
      const id = objectId(subscription.id, "sub_", "subscription.id");
      return synchronize(id, objectId(subscription.customer, "cus_", "subscription.customer"), event);
    }
  });
}

module.exports = { createSaasWebhookHandlers };
