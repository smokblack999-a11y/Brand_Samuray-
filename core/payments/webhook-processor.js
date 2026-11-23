"use strict";

const { paymentError } = require("./provider-contract");

function createStripeWebhookProcessor({ provider, ledger, handlers = {} } = {}) {
  if (!provider || typeof provider.verifyWebhook !== "function" || typeof provider.parseWebhook !== "function") {
    throw paymentError("PAYMENT_WEBHOOK_PROVIDER_INVALID", "A webhook-capable payment provider is required");
  }
  if (!ledger || typeof ledger.claimEvent !== "function" || typeof ledger.markEvent !== "function") {
    throw paymentError("PAYMENT_WEBHOOK_LEDGER_INVALID", "A payment ledger with event-claim support is required");
  }

  return Object.freeze({
    async process(rawBody, headers = {}) {
      const verified = await provider.verifyWebhook(rawBody, headers);
      const event = await provider.parseWebhook(verified);
      const objectId = typeof event.object.id === "string" ? event.object.id : null;
      const claim = ledger.claimEvent(event.eventId, event.type, objectId);
      if (!claim.claimed && claim.inProgress) {
        throw paymentError("PAYMENT_WEBHOOK_IN_PROGRESS", "An earlier delivery of this event is still processing; retry later");
      }
      if (!claim.claimed && claim.duplicate) return { received: true, duplicate: true, eventId: event.eventId };
      if (!claim.claimed) throw paymentError("PAYMENT_WEBHOOK_CLAIM_FAILED", "Webhook event could not be claimed safely");

      const handler = handlers[event.type];
      if (typeof handler !== "function") {
        ledger.markEvent(event.eventId, "failed", "UNHANDLED_EVENT");
        throw paymentError("PAYMENT_WEBHOOK_UNHANDLED", "No handler is registered for verified event type " + event.type);
      }

      try {
        await handler(event.object, event);
        ledger.markEvent(event.eventId, "completed");
        return { received: true, duplicate: false, eventId: event.eventId };
      } catch (error) {
        ledger.markEvent(event.eventId, "failed", error.code || "HANDLER_FAILED");
        throw error;
      }
    }
  });
}

module.exports = { createStripeWebhookProcessor };
