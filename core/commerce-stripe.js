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
  const session = event.data.object;
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return { ignored: true, type: event.type };
  }
  if (session.payment_status !== "paid") return { pending: true, orderId: session.metadata?.order_id || null };
  const orderId = String(session.metadata?.order_id || session.client_reference_id || "");
  if (!orderId || !String(session.id || "").startsWith("cs_test_")) {
    const error = new Error("Checkout session is not a valid configured test session"); error.code = "INVALID_CHECKOUT_SESSION"; throw error;
  }
  const amountMinor = Number(session.amount_total);
  if (!Number.isSafeInteger(amountMinor) || amountMinor % 100 !== 0) {
    const error = new Error("Stripe amount is not a whole KZT amount"); error.code = "PAYMENT_AMOUNT_INVALID"; throw error;
  }
  const result = commerce.applyVerifiedPayment({
    verified: true, eventId: event.id, orderId, sessionId: session.id,
    amountKzt: amountMinor / 100, currency: String(session.currency || "").toUpperCase(),
    provider: "stripe_test"
  });
  return { ...result, pending: false };
}

module.exports = { verifyStripeSignature, processStripeEvent };
