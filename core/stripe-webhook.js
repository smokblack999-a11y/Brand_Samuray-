"use strict";

const crypto = require("node:crypto");

function text(value, max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseSignatureHeader(header) {
  const values = {};
  for (const part of String(header || "").split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!values[key]) values[key] = [];
    values[key].push(value);
  }
  return values;
}

function verifySignature(rawBody, header, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!rawBody || !header || !secret) return false;
  const parsed = parseSignatureHeader(header);
  const timestamp = Number(parsed.t?.[0]);
  if (!Number.isInteger(timestamp)) return false;
  const tolerance = Math.max(0, Number(toleranceSeconds));
  if (tolerance && Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const signed = Buffer.concat([
    Buffer.from(String(timestamp) + ".", "utf8"),
    payload
  ]);
  const expected = crypto.createHmac("sha256", String(secret)).update(signed).digest("hex");
  return (parsed.v1 || []).some(candidate => safeEqualHex(expected, candidate));
}

function amountToKZT(amountMinor, currency) {
  const minor = Number(amountMinor);
  if (!Number.isFinite(minor) || minor < 0) return null;
  const code = text(currency, 8).toUpperCase();
  if (!code) return null;
  if (code === "KZT") return Math.round(minor) / 100;
  const envName = `STRIPE_${code}_KZT_RATE`;
  const rate = Number(process.env[envName] || 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((minor / 100) * rate * 100) / 100;
}

function metadataFor(object) {
  return object && object.metadata && typeof object.metadata === "object" ? object.metadata : {};
}

function normalizeStripeEvent(event, options = {}) {
  if (!event || typeof event !== "object") throw new Error("Stripe event is required");
  const eventId = text(event.id, 256);
  const eventType = text(event.type, 128);
  const object = event.data?.object || {};
  if (!eventId) throw new Error("Stripe event id is required");

  let status = null;
  let amountMinor = null;
  let currency = text(object.currency, 8).toUpperCase();
  let metadata = metadataFor(object);
  let customerId = text(object.customer, 256);
  let externalReference = text(object.id, 256);

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    if (eventType === "checkout.session.completed" && text(object.payment_status, 32).toLowerCase() !== "paid") {
      return { ignored: true, reason: "CHECKOUT_NOT_PAID", eventId, eventType };
    }
    status = "WON";
    amountMinor = object.amount_total;
    metadata = metadataFor(object);
    currency = text(object.currency, 8).toUpperCase();
    customerId = text(object.customer, 256);
    externalReference = text(object.id || object.payment_intent, 256);
  } else if (eventType === "refund.created") {
    status = "REFUNDED";
    amountMinor = object.amount;
    metadata = metadataFor(object);
    currency = text(object.currency, 8).toUpperCase();
    customerId = text(object.customer, 256);
    externalReference = text(object.id || object.payment_intent || object.charge, 256);
  } else {
    return { ignored: true, reason: "UNSUPPORTED_EVENT", eventId, eventType };
  }

  const revenueKZT = amountToKZT(amountMinor, currency);
  if (revenueKZT == null) {
    throw Object.assign(
      new Error(`Unable to convert Stripe ${currency || "unknown"} amount to KZT; configure STRIPE_${currency || "CURRENCY"}_KZT_RATE or use KZT`),
      { code: "STRIPE_FX_RATE_REQUIRED" }
    );
  }

  const tenantId = text(
    metadata.tenant_id ||
    options.defaultTenantId ||
    process.env.TENANT_ID ||
    "default",
    128
  ) || "default";

  const grossMarginRate = Number(
    metadata.gross_margin_rate ??
    options.grossMarginRate ??
    process.env.DEFAULT_GROSS_MARGIN ??
    0
  );

  const baselineConversionProbability = Number(metadata.baseline_conversion_probability ?? 0);
  const actionId = text(metadata.decision_id || metadata.action_id, 256);
  const correlationId = text(metadata.correlation_id, 256);

  return {
    ignored: false,
    eventId,
    eventType,
    tenantId,
    status,
    revenueKZT,
    amountMinor: Number(amountMinor),
    currency: currency || "KZT",
    grossMarginRate: Number.isFinite(grossMarginRate) ? grossMarginRate : 0,
    baselineConversionProbability: Number.isFinite(baselineConversionProbability) ? baselineConversionProbability : 0,
    actionId: actionId || undefined,
    customerId: customerId || undefined,
    externalReference: externalReference || undefined,
    correlationId: correlationId || undefined,
    provider: "stripe",
    source: "stripe-webhook",
    attributionPolicy: text(metadata.attribution_policy, 64) || "ASSISTED",
    occurredAt: event.created ? new Date(Number(event.created) * 1000).toISOString() : new Date().toISOString()
  };
}

module.exports = { parseSignatureHeader, verifySignature, amountToKZT, normalizeStripeEvent };
