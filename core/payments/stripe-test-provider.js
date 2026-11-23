"use strict";

const crypto = require("node:crypto");
const { paymentError } = require("./provider-contract");

const API_VERSION = "2026-11-18.endive";

function requiredString(value, code, field) {
  if (typeof value !== "string" || !value.trim()) throw paymentError(code, field + " is required");
  return value.trim();
}

function safeUrl(value, field) {
  const raw = requiredString(value, "PAYMENT_INPUT_INVALID", field);
  let parsed;
  try { parsed = new URL(raw); } catch { throw paymentError("PAYMENT_INPUT_INVALID", field + " must be a valid URL"); }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw paymentError("PAYMENT_INPUT_INVALID", field + " must use HTTPS");
  }
  return parsed.toString();
}

function idempotencyKey(value) {
  const key = requiredString(value, "PAYMENT_IDEMPOTENCY_REQUIRED", "idempotencyKey");
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(key)) throw paymentError("PAYMENT_IDEMPOTENCY_INVALID", "idempotencyKey has an invalid format");
  return key;
}

function integrationLabel(prefix) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(8);
  let suffix = "";
  for (const byte of bytes) suffix += letters[byte % letters.length];
  return prefix + suffix;
}

function createStripeTestProvider({ StripeClient, apiKey, webhookSecret, apiVersion = API_VERSION } = {}) {
  if (typeof StripeClient !== "function") throw paymentError("STRIPE_SDK_REQUIRED", "Pass the official Stripe Node SDK constructor");
  const key = requiredString(apiKey, "STRIPE_TEST_KEY_REQUIRED", "apiKey");
  if (!/^(sk|rk)_test_/.test(key)) throw paymentError("STRIPE_TEST_KEY_ONLY", "Only Stripe test-mode secret or restricted keys are accepted");
  const signingSecret = requiredString(webhookSecret, "STRIPE_WEBHOOK_SECRET_REQUIRED", "webhookSecret");
  if (!signingSecret.startsWith("whsec_")) throw paymentError("STRIPE_WEBHOOK_SECRET_INVALID", "Webhook signing secret must use the whsec_ prefix");
  const stripe = new StripeClient(key, { apiVersion });

  async function createCheckout(params, keyValue) {
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: idempotencyKey(keyValue) });
    if (!session || typeof session.url !== "string" || !session.url.startsWith("https://")) {
      throw paymentError("STRIPE_CHECKOUT_INVALID_RESPONSE", "Stripe did not return a hosted Checkout URL");
    }
    return { sessionId: session.id, checkoutUrl: session.url, mode: "test" };
  }

  return Object.freeze({
    name: "stripe_test",

    async createOneTimeCheckout(input = {}) {
      const orderId = requiredString(input.orderId, "PAYMENT_INPUT_INVALID", "orderId");
      const customerId = requiredString(input.customerId, "PAYMENT_INPUT_INVALID", "customerId");
      const productName = requiredString(input.productName, "PAYMENT_INPUT_INVALID", "productName");
      const currency = requiredString(input.currency, "PAYMENT_INPUT_INVALID", "currency").toLowerCase();
      const amountMinor = input.amountMinor;
      if (!/^[a-z]{3}$/.test(currency) || !Number.isSafeInteger(amountMinor) || amountMinor < 1) {
        throw paymentError("PAYMENT_INPUT_INVALID", "currency or amountMinor is invalid");
      }
      return createCheckout({
        mode: "payment",
        client_reference_id: orderId,
        line_items: [{ quantity: 1, price_data: { currency, unit_amount: amountMinor, product_data: { name: productName } } }],
        success_url: safeUrl(input.successUrl, "successUrl"),
        cancel_url: safeUrl(input.cancelUrl, "cancelUrl"),
        metadata: {
          samurai_order_id: orderId,
          samurai_customer_id: customerId,
          samurai_flow: "delivery",
          samurai_checkout_ref: integrationLabel("delivery_")
        },
        payment_intent_data: { metadata: { samurai_order_id: orderId, samurai_customer_id: customerId, samurai_flow: "delivery" } }
      }, input.idempotencyKey);
    },

    async createSubscriptionCheckout(input = {}) {
      const customerId = requiredString(input.customerId, "PAYMENT_INPUT_INVALID", "customerId");
      const planId = requiredString(input.planId, "PAYMENT_INPUT_INVALID", "planId");
      const priceId = requiredString(input.priceId, "PAYMENT_INPUT_INVALID", "priceId");
      if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw paymentError("PAYMENT_PRICE_INVALID", "A server-owned Stripe Price ID is required");
      return createCheckout({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: safeUrl(input.successUrl, "successUrl"),
        cancel_url: safeUrl(input.cancelUrl, "cancelUrl"),
        client_reference_id: customerId,
        metadata: {
          samurai_customer_id: customerId,
          samurai_plan_id: planId,
          samurai_flow: "saas",
          samurai_checkout_ref: integrationLabel("saas_")
        },
        subscription_data: { metadata: { samurai_customer_id: customerId, samurai_plan_id: planId, samurai_flow: "saas" } }
      }, input.idempotencyKey);
    },

    async verifyWebhook(rawBody, headers = {}) {
      if (!Buffer.isBuffer(rawBody)) throw paymentError("STRIPE_WEBHOOK_RAW_BODY_REQUIRED", "Webhook verification requires the exact raw request body");
      const signature = headers["stripe-signature"] || headers["Stripe-Signature"];
      if (typeof signature !== "string" || !signature) throw paymentError("STRIPE_WEBHOOK_SIGNATURE_REQUIRED", "Stripe-Signature header is required");
      try { return stripe.webhooks.constructEvent(rawBody, signature, signingSecret); }
      catch { throw paymentError("STRIPE_WEBHOOK_SIGNATURE_INVALID", "Stripe webhook signature verification failed"); }
    },

    async parseWebhook(event) {
      if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data || !event.data.object) {
        throw paymentError("STRIPE_WEBHOOK_EVENT_INVALID", "Verified Stripe event has an invalid structure");
      }
      return { eventId: event.id, type: event.type, object: event.data.object };
    },

    async refund(input = {}) {
      const paymentIntentId = requiredString(input.paymentIntentId, "PAYMENT_INPUT_INVALID", "paymentIntentId");
      if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) throw paymentError("PAYMENT_REFERENCE_INVALID", "A trusted internal PaymentIntent reference is required");
      const params = { payment_intent: paymentIntentId };
      if (input.amountMinor !== undefined) {
        if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw paymentError("PAYMENT_INPUT_INVALID", "amountMinor must be a positive integer");
        params.amount = input.amountMinor;
      }
      if (input.reason !== undefined) {
        if (!["duplicate", "fraudulent", "requested_by_customer"].includes(input.reason)) throw paymentError("PAYMENT_INPUT_INVALID", "Refund reason is invalid");
        params.reason = input.reason;
      }
      return stripe.refunds.create(params, { idempotencyKey: idempotencyKey(input.idempotencyKey) });
    },

    async health() {
      return { ok: true, provider: "stripe_test", mode: "test", apiVersion };
    }
  });
}

module.exports = { API_VERSION, createStripeTestProvider };
