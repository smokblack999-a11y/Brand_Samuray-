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

function publicAppUrl() {
  const value = String(process.env.EVOLUTION_PUBLIC_URL || "");
  let url;
  try { url = new URL(value); } catch { throw new Error("EVOLUTION_PUBLIC_URL_must_be_configured"); }
  if (url.protocol !== "https:") throw new Error("EVOLUTION_PUBLIC_URL_must_use_https");
  return url.origin;
}
function stripeSecret() {
  const key = String(process.env.STRIPE_SECRET_KEY || "");
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(key)) throw new Error("STRIPE_SECRET_KEY_not_configured");
  return key;
}
async function stripePost(path, fields, idempotencyKey) {
  const key = stripeSecret();
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 255) {
    throw new Error("stable_idempotency_key_required");
  }
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("stripe_api_request_failed");
    error.code = body?.error?.code || "STRIPE_API_ERROR";
    error.status = response.status;
    throw error;
  }
  return body;
}
async function createCheckoutSession({ plan, workspaceId, customerId, customerEmail, idempotencyKey }) {
  const allowedPlans = new Set(["starter", "pro", "agency"]);
  if (!allowedPlans.has(plan)) throw new Error("unsupported_plan");
  if (typeof workspaceId !== "string" || !/^[A-Za-z0-9_-]{3,128}$/.test(workspaceId)) throw new Error("valid_workspace_id_required");
  const priceId = String(process.env["STRIPE_PRICE_" + plan.toUpperCase()] || "");
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new Error("stripe_price_not_configured_for_plan");
  if (!customerId && (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
    throw new Error("valid_customer_identity_required");
  }
  const origin = publicAppUrl();
  const fields = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: origin + "/billing/success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/billing/cancel",
    client_reference_id: workspaceId,
    "metadata[workspace_id]": workspaceId,
    "metadata[plan]": plan,
    "subscription_data[metadata][workspace_id]": workspaceId,
    "subscription_data[metadata][plan]": plan
  };
  if (customerId) fields.customer = customerId;
  else fields.customer_email = customerEmail;
  const session = await stripePost("checkout/sessions", fields, idempotencyKey);
  if (!session || typeof session.id !== "string" || typeof session.url !== "string") throw new Error("stripe_checkout_session_response_invalid");
  return { id: session.id, url: session.url, status: session.status || "open" };
}
async function createCustomerPortalSession({ customerId, idempotencyKey }) {
  if (typeof customerId !== "string" || !/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error("valid_stripe_customer_id_required");
  const origin = publicAppUrl();
  const session = await stripePost("billing_portal/sessions", {
    customer: customerId,
    return_url: origin + "/settings/billing"
  }, idempotencyKey);
  if (!session || typeof session.url !== "string") throw new Error("stripe_portal_session_response_invalid");
  return { url: session.url };
}

module.exports = { verifyStripeSignature, classifyStripeEvent, handleStripeWebhook, createCheckoutSession, createCustomerPortalSession };
