"use strict";

const crypto = require("node:crypto");
const commerce = require("./commerce");

function verifyStripeSignature(rawBody, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(rawBody) || !header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(",").map((part) => {
    const i = part.indexOf("="); return i < 0 ? ["", ""] : [part.slice(0, i), part.slice(i + 1)];
  }).filter(([k]) => k));
  const timestamp = Number(parts.t);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(String(timestamp) + ".").update(rawBody).digest("hex");
  const signatures = String(header).split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const a = Buffer.from(expected, "hex"); const b = Buffer.from(candidate, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function processStripeEvent(event) {
  if (!event || typeof event.id !== "string" || !event.id || !event.data?.object) {
    const error = new Error("Malformed Stripe event"); error.code = "INVALID_STRIPE_EVENT"; throw error;
  }
  if (event.livemode !== false) {
    const error = new Error("Live-mode Stripe events are disabled"); error.code = "LIVE_PAYMENT_MODE_DISABLED"; throw error;
  }
  const session = event.data.object;
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return { ignored: true, type: event.type };
  }
  if (session.livemode !== false || session.mode !== "payment") {
    const error = new Error("Only test-mode one-time Checkout sessions are accepted"); error.code = "INVALID_CHECKOUT_MODE"; throw error;
  }
  if (session.payment_status !== "paid" || session.status !== "complete") {
    return { pending: true, orderId: session.metadata?.order_id || null };
  }
  const metadataOrderId = String(session.metadata?.order_id || "");
  const clientReferenceId = String(session.client_reference_id || "");
  if (!metadataOrderId || !clientReferenceId || metadataOrderId !== clientReferenceId ||
      !String(session.id || "").startsWith("cs_test_")) {
    const error = new Error("Checkout session does not match its order reference"); error.code = "INVALID_CHECKOUT_SESSION"; throw error;
  }
  const amountMinor = Number(session.amount_total);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor % 100 !== 0) {
    const error = new Error("Stripe amount is not a whole KZT amount in minor units"); error.code = "PAYMENT_AMOUNT_INVALID"; throw error;
  }
  const result = commerce.applyVerifiedPayment({
    verified: true, eventId: event.id, orderId: metadataOrderId, sessionId: session.id,
    amountKzt: amountMinor / 100, currency: String(session.currency || "").toUpperCase(),
    provider: "stripe_test"
  });
  return { ...result, pending: false };
}

module.exports = { verifyStripeSignature, processStripeEvent };
