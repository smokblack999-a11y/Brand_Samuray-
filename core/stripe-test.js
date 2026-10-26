"use strict";

const crypto = require("node:crypto");
const CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";
const SESSION_ID_RE = /^cs_test_[A-Za-z0-9]+$/;
const EVENT_ID_RE = /^evt_[A-Za-z0-9]+$/;
const SIG_RE = /^[a-f0-9]{64}$/i;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function httpsUrl(value, checkoutOnly = false) {
  try { const u = new URL(String(value || ""));
    if (u.protocol !== "https:" || u.username || u.password || u.hash) return null;
    if (checkoutOnly && u.hostname !== "checkout.stripe.com") return null;
    return u;
  } catch { return null; }
}
function getConfig(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  const enabled = String(env.NODE_ENV || "").toLowerCase() !== "production" &&
    String(env.COMMERCE_ENABLED || "").toLowerCase() === "true" && String(env.COMMERCE_MODE || "").toLowerCase() === "test" && String(env.STRIPE_TEST_MODE || "").toLowerCase() === "true";
  return { enabled, key: /^sk_test_[A-Za-z0-9_]+$/.test(key) ? key : "",
    webhookSecret: /^whsec_[A-Za-z0-9_]+$/.test(webhookSecret) ? webhookSecret : "",
    successUrl: httpsUrl(env.STRIPE_SUCCESS_URL), cancelUrl: httpsUrl(env.STRIPE_CANCEL_URL) };
}
function stripeAmountMinor(order) {
  if (!order || !Number.isSafeInteger(order.totalMinor) || order.totalMinor < 1) throw err("STRIPE_AMOUNT_INVALID", "Invalid order amount");
  const value = order.currency === "KZT" ? order.totalMinor * 100 : order.totalMinor;
  if (!Number.isSafeInteger(value) || value < 1) throw err("STRIPE_AMOUNT_INVALID", "Unsafe order amount");
  return value;
}
function successUrlWithSession(url) {
  const u = new URL(url.toString()); u.searchParams.delete("session_id");
  return u.toString() + (u.search ? "&" : "?") + "session_id={CHECKOUT_SESSION_ID}";
}
function createStripeTestClient({ env = process.env, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), toleranceSeconds = 300 } = {}) {
  function config() { return getConfig(env); }
  function isConfigured() { const c = config(); return c.enabled && Boolean(c.key && c.webhookSecret && c.successUrl && c.cancelUrl); }
  function isWebhookConfigured() { const c = config(); return c.enabled && Boolean(c.webhookSecret); }
  async function createCheckoutSession(order) {
    const c = config(); if (!isConfigured()) throw err("STRIPE_TEST_NOT_CONFIGURED", "Stripe test mode is not configured");
    if (!order || !/^ord_[a-f0-9]{24}$/.test(String(order.id || "")) || !order.customerId ||
      !["KZT", "USD", "EUR"].includes(order.currency) || !Number.isSafeInteger(order.quantity) || order.quantity < 1 || order.quantity > 20 ||
      !Number.isSafeInteger(order.unitPriceMinor) || order.unitPriceMinor < 1 || !Number.isSafeInteger(order.totalMinor) ||
      order.totalMinor !== order.unitPriceMinor * order.quantity || !["digital", "physical"].includes(order.productType) || !String(order.productName || "").trim()) {
      throw err("STRIPE_ORDER_INVALID", "Order is invalid for Checkout");
    }
    const attempt = order.stripeCheckoutAttempt;
    const defaultExpiry = Math.floor(now() / 1000) + Math.floor(23.5 * 60 * 60);
    const expiresAt = attempt
      ? Math.floor(Date.parse(attempt.expiresAt) / 1000)
      : defaultExpiry;
    const secondsRemaining = expiresAt - Math.floor(now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || secondsRemaining < 30 * 60 || secondsRemaining > 24 * 60 * 60) {
      throw err("STRIPE_CHECKOUT_RECONCILIATION_REQUIRED", "The previous Checkout attempt is outside the safe retry window");
    }
    if (attempt && (!/^samurai-order-ord_[a-f0-9]{24}-[a-f0-9]{24}$/.test(String(attempt.idempotencyKey || "")))) {
      throw err("STRIPE_CHECKOUT_ATTEMPT_INVALID", "Invalid Checkout attempt state");
    }
    const idempotencyKey = attempt ? attempt.idempotencyKey : "samurai-order-" + order.id;
    const form = new URLSearchParams(); form.set("mode", "payment");
    form.set("client_reference_id", order.id); form.set("success_url", successUrlWithSession(c.successUrl));
    form.set("cancel_url", c.cancelUrl.toString()); form.set("metadata[order_id]", order.id);
    form.set("metadata[customer_id]", order.customerId); form.set("metadata[environment]", "test");
    form.set("line_items[0][price_data][currency]", order.currency.toLowerCase());
    form.set("line_items[0][price_data][unit_amount]", String(order.currency === "KZT" ? order.unitPriceMinor * 100 : order.unitPriceMinor));
    form.set("line_items[0][price_data][product_data][name]", order.productName.slice(0, 250));
    form.set("line_items[0][quantity]", String(order.quantity));
    form.set("expires_at", String(expiresAt));
    let response;
    try { response = await fetchImpl(CHECKOUT_URL, { method: "POST", headers: { Authorization: "Bearer " + c.key, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey }, body: form.toString(), signal: AbortSignal.timeout(10000) }); }
    catch { throw err("STRIPE_UPSTREAM_UNAVAILABLE", "Stripe test API is unreachable"); }
    if (!response.ok) {
      if (Number.isInteger(response.status) && response.status >= 400 && response.status < 500) {
        throw err("STRIPE_CHECKOUT_REJECTED", "Stripe rejected the Checkout request");
      }
      throw err("STRIPE_UPSTREAM_UNAVAILABLE", "Stripe test API returned an unsuccessful response");
    }
    const payload = await response.json().catch(() => null);
    if (!payload || !SESSION_ID_RE.test(String(payload.id || "")) || payload.livemode !== false || !httpsUrl(payload.url, true) ||
        !Number.isSafeInteger(payload.expires_at) || payload.expires_at !== expiresAt) {
      throw err("STRIPE_SESSION_INVALID", "Stripe did not return a valid test Checkout Session");
    }
    return { id: payload.id, url: payload.url, livemode: false, expires_at: payload.expires_at };
  }
  function verifyAndParseWebhook(rawBody, signatureHeader) {
    const c = config(); if (!c.enabled || !c.webhookSecret) throw err("STRIPE_TEST_NOT_CONFIGURED", "Stripe test webhook is not configured");
    if (!Buffer.isBuffer(rawBody) || rawBody.length < 1 || rawBody.length > 1024 * 1024) throw err("STRIPE_WEBHOOK_BODY_INVALID", "Invalid webhook body");
    const pieces = String(signatureHeader || "").split(",").map(x => x.trim());
    const t = pieces.find(x => x.startsWith("t=")); const timestamp = t ? Number(t.slice(2)) : NaN;
    const signatures = pieces.filter(x => x.startsWith("v1=")).map(x => x.slice(3)).filter(x => SIG_RE.test(x));
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || Math.abs(Math.floor(now() / 1000) - timestamp) > toleranceSeconds || !signatures.length) throw err("STRIPE_SIGNATURE_INVALID", "Invalid or expired Stripe signature");
    const expected = crypto.createHmac("sha256", c.webhookSecret).update(String(timestamp) + ".").update(rawBody).digest();
    const matched = signatures.some(value => { const actual = Buffer.from(value, "hex"); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); });
    if (!matched) throw err("STRIPE_SIGNATURE_INVALID", "Invalid or expired Stripe signature");
    let event; try { event = JSON.parse(rawBody.toString("utf8")); } catch { throw err("STRIPE_EVENT_INVALID", "Invalid Stripe event JSON"); }
    if (!event || !EVENT_ID_RE.test(String(event.id || "")) || typeof event.type !== "string" || !event.data || !event.data.object || event.livemode !== false) throw err("STRIPE_EVENT_INVALID", "Only Stripe test events are accepted");
    return event;
  }
  return { isConfigured, isWebhookConfigured, createCheckoutSession, verifyAndParseWebhook, stripeAmountMinor };
}

function registerStripeTestWebhook(app, { storeProvider, stripeClient, rawBodyMiddleware, env = process.env } = {}) {
  if (!app || typeof app.post !== "function" || typeof storeProvider !== "function" || !stripeClient || typeof stripeClient.verifyAndParseWebhook !== "function" || typeof stripeClient.isWebhookConfigured !== "function" || typeof rawBodyMiddleware !== "function") throw new TypeError("Stripe webhook dependencies are required");
  const gate = (_req, res, next) => {
    const enabled = String(env.NODE_ENV || "").toLowerCase() !== "production" && String(env.COMMERCE_ENABLED || "").toLowerCase() === "true" && String(env.COMMERCE_MODE || "").toLowerCase() === "test" && String(env.STRIPE_TEST_MODE || "").toLowerCase() === "true";
    if (!enabled) return res.status(404).json({ ok: false, error: { code: "STRIPE_TEST_DISABLED", message: "Stripe test webhook is disabled" } });
    if (!stripeClient.isWebhookConfigured()) return res.status(503).json({ ok: false, error: { code: "STRIPE_TEST_NOT_CONFIGURED", message: "Stripe test webhook is not configured" } });
    return next();
  };
  app.post("/webhooks/stripe", gate, rawBodyMiddleware, async (req, res) => {
    let event;
    try { event = stripeClient.verifyAndParseWebhook(req.body, req.get ? req.get("Stripe-Signature") : req.headers?.["stripe-signature"]); }
    catch (error) { const status = error.code === "STRIPE_TEST_NOT_CONFIGURED" ? 503 : 400; return res.status(status).json({ ok: false, error: { code: error.code || "STRIPE_WEBHOOK_REJECTED", message: status === 503 ? "Stripe test webhook is not configured" : "Stripe webhook rejected" } }); }
    const supported = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"]);
    if (!supported.has(event.type)) return res.status(200).json({ received: true, processed: false, reason: "event_ignored" });
    const session = event.data.object;
    if (!session || typeof session !== "object" || !SESSION_ID_RE.test(String(session.id || "")) || session.livemode !== false) return res.status(400).json({ ok: false, error: { code: "STRIPE_SESSION_INVALID", message: "Stripe webhook rejected" } });
    const metadataOrderId = session.metadata?.order_id; const metadataCustomerId = session.metadata?.customer_id;
    if (!metadataOrderId || !metadataCustomerId) return res.status(400).json({ ok: false, error: { code: "STRIPE_METADATA_INVALID", message: "Stripe webhook rejected" } });
    let store; try { store = await storeProvider(); } catch { store = null; }
    if (!store) return res.status(503).json({ ok: false, error: { code: "COMMERCE_NOT_READY", message: "Commerce is not ready" } });
    try {
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        if (session.payment_status !== "paid") return res.status(200).json({ received: true, processed: false, reason: "payment_not_paid" });
        const result = await store.markStripePaid({ orderId: metadataOrderId, sessionId: session.id, eventId: event.id, metadataOrderId, metadataCustomerId, clientReferenceId: session.client_reference_id, amountTotal: session.amount_total, currency: String(session.currency || "").toUpperCase(), paymentStatus: session.payment_status, livemode: event.livemode });
        return res.status(200).json({ received: true, processed: true, duplicate: Boolean(result.duplicate) });
      }
      const result = await store.cancelStripeCheckout({ orderId: metadataOrderId, sessionId: session.id, eventId: event.id, metadataOrderId, metadataCustomerId, livemode: event.livemode, reason: event.type === "checkout.session.expired" ? "checkout_expired" : "async_payment_failed" });
      return res.status(200).json({ received: true, processed: true, duplicate: Boolean(result.duplicate) });
    } catch (error) {
      const conflicts = new Set(["STRIPE_ORDER_MISMATCH", "STRIPE_SESSION_MISMATCH", "STRIPE_AMOUNT_MISMATCH", "STRIPE_LIVE_EVENT_REJECTED", "STRIPE_PAYMENT_NOT_PAID", "ORDER_ALREADY_FULFILLED", "ORDER_NOT_PENDING"]);
      const status = error.code === "COMMERCE_NOT_READY" ? 503 : conflicts.has(error.code) ? 409 : error.code === "ORDER_NOT_FOUND" ? 404 : 400;
      return res.status(status).json({ ok: false, error: { code: error.code || "STRIPE_EVENT_REJECTED", message: "Stripe event could not be applied" } });
    }
  });
}
module.exports = { createStripeTestClient, registerStripeTestWebhook, stripeAmountMinor, getConfig };
