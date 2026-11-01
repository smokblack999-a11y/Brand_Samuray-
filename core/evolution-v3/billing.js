"use strict";

const crypto = require("node:crypto");

function parseSignatureHeader(header) {
  const values = { v1: [] };
  for (const part of String(header || "").split(",")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === "v1") values.v1.push(value);
    else values[key] = value;
  }
  return values;
}
function verifyStripeSignature(rawBody, signatureHeader, secret, { now = Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = {}) {
  if (!Buffer.isBuffer(rawBody)) throw new Error("raw_request_body_buffer_required");
  if (!secret || String(secret).length < 16) throw new Error("stripe_webhook_secret_missing");
  const parsed = parseSignatureHeader(signatureHeader);
  const timestamp = Number(parsed.t);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) return false;
  const signedPayload = String(timestamp) + "." + rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return parsed.v1.some(candidate => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(candidate, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
function classifyStripeEvent(event) {
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") return "REJECT";
  const supported = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed"
  ]);
  return supported.has(event.type) ? "REQUIRES_STATE_RECONCILIATION" : "IGNORED";
}
async function handleStripeWebhook({ rawBody, signature, secret, eventStore, reconcileSubscription, now }) {
  if (!verifyStripeSignature(rawBody, signature, secret, { now })) {
    return { status: 400, body: { received: false, error: "invalid_signature" } };
  }
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); }
  catch { return { status: 400, body: { received: false, error: "invalid_json" } }; }
  const classification = classifyStripeEvent(event);
  if (classification === "REJECT") return { status: 400, body: { received: false, error: "invalid_event" } };
  if (classification === "IGNORED") return { status: 200, body: { received: true, ignored: true } };
  if (!eventStore || typeof eventStore.claim !== "function") throw new Error("durable_event_store_required");
  if (typeof reconcileSubscription !== "function") throw new Error("subscription_reconciler_required");
  const claim = await eventStore.claim(event.id);
  if (!claim || claim.claimed !== true) return { status: 200, body: { received: true, duplicate: true } };
  try {
    await reconcileSubscription(event);
    if (typeof eventStore.complete === "function") await eventStore.complete(event.id);
    return { status: 200, body: { received: true, reconciled: true } };
  } catch (error) {
    if (typeof eventStore.fail === "function") {
      await eventStore.fail(event.id, String(error && error.message || "reconciliation_failed").slice(0, 500));
    }
    throw error;
  }
}
module.exports = { verifyStripeSignature, classifyStripeEvent, handleStripeWebhook };
