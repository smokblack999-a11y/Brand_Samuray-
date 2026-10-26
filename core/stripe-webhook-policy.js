"use strict";

// Only deterministic, permanent payment-event rejections should return 4xx to Stripe.
// Any unknown/internal error is retryable: the event may be valid but failed to persist.
const PERMANENT_STRIPE_EVENT_CODES = new Set([
  "INVALID_STRIPE_EVENT",
  "LIVE_PAYMENT_MODE_DISABLED",
  "INVALID_CHECKOUT_MODE",
  "INVALID_CHECKOUT_SESSION",
  "PAYMENT_AMOUNT_INVALID",
  "PAYMENT_REFERENCE_REQUIRED",
  "INVALID_PAYMENT_AMOUNT",
  "ORDER_NOT_FOUND",
  "PAYMENT_SESSION_MISMATCH",
  "PAYMENT_MISMATCH",
  "PAYMENT_EVENT_REPLAY_MISMATCH",
  "PAYMENT_EVENT_STATE_MISMATCH",
  "PAYMENT_NOT_VERIFIED"
]);

function stripeWebhookFailureStatus(error) {
  return error && PERMANENT_STRIPE_EVENT_CODES.has(String(error.code || "")) ? 400 : 500;
}

module.exports = { stripeWebhookFailureStatus, PERMANENT_STRIPE_EVENT_CODES };
