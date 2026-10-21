"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "commerce-orders.json");
const EVENTS_FILE = path.join(DATA_DIR, "commerce-payment-events.json");
const CURRENCY = String(process.env.COMMERCE_CURRENCY || "KZT").toUpperCase();

function readJson(file, fallback) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2) + "\n", { flag: "wx" });
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  fs.renameSync(temp, file);
}
function readOrders() { return readJson(ORDERS_FILE, []); }
function readEvents() { return readJson(EVENTS_FILE, []); }
function fail(code, message) { const e = new Error(message); e.code = code; return e; }

function parseConfig(raw, name) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { throw fail("INVALID_COMMERCE_CONFIG", name + " must be valid JSON"); }
  if (!Array.isArray(value)) throw fail("INVALID_COMMERCE_CONFIG", name + " must be a JSON array");
  return value;
}
function getCatalog() {
  return parseConfig(process.env.COMMERCE_PRODUCTS_JSON, "COMMERCE_PRODUCTS_JSON").map((p) => ({
    id: String(p.id || "").trim(),
    name: String(p.name || "").trim(),
    priceKzt: Number(p.priceKzt),
    active: p.active !== false
  })).filter((p) => p.id && p.name && Number.isSafeInteger(p.priceKzt) && p.priceKzt > 0 && p.active);
}
function getDeliveryZones() {
  let value = {};
  try { value = JSON.parse(process.env.COMMERCE_DELIVERY_ZONES_JSON || "{}"); }
  catch { throw fail("INVALID_COMMERCE_CONFIG", "COMMERCE_DELIVERY_ZONES_JSON must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("INVALID_COMMERCE_CONFIG", "COMMERCE_DELIVERY_ZONES_JSON must be an object");
  for (const [zone, fee] of Object.entries(value)) {
    if (!zone.trim() || !Number.isSafeInteger(fee) || fee < 0) throw fail("INVALID_COMMERCE_CONFIG", "Delivery zone fees must be non-negative integer KZT amounts");
  }
  return value;
}
function getOrder(id) { return readOrders().find((o) => o.id === String(id)) || null; }
function listOrders(filter = {}) {
  return readOrders().filter((o) =>
    (filter.customerId == null || o.customerId === String(filter.customerId)) &&
    (filter.courierId == null || o.courierId === String(filter.courierId)) &&
    (filter.status == null || o.status === filter.status)
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function createOrder(input) {
  const customerId = String(input.customerId || "").trim();
  const productId = String(input.productId || "").trim();
  const quantity = Number(input.quantity || 1);
  const fulfillment = String(input.fulfillment || "");
  if (!customerId) throw fail("CUSTOMER_REQUIRED", "Telegram customer ID is required");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw fail("INVALID_QUANTITY", "Quantity must be an integer from 1 to 100");
  if (!["pickup", "delivery"].includes(fulfillment)) throw fail("INVALID_FULFILLMENT", "Fulfillment must be pickup or delivery");
  const product = getCatalog().find((p) => p.id === productId);
  if (!product) throw fail("PRODUCT_NOT_FOUND", "Product is not available");
  let deliveryFeeKzt = 0;
  let address = null;
  let deliveryZone = null;
  if (fulfillment === "delivery") {
    address = String(input.address || "").trim();
    deliveryZone = String(input.deliveryZone || "").trim();
    if (address.length < 5 || address.length > 500) throw fail("ADDRESS_REQUIRED", "A valid delivery address is required");
    const zones = getDeliveryZones();
    if (!Object.prototype.hasOwnProperty.call(zones, deliveryZone)) throw fail("DELIVERY_ZONE_NOT_FOUND", "Choose a configured delivery zone");
    deliveryFeeKzt = zones[deliveryZone];
  }
  const itemsTotalKzt = product.priceKzt * quantity;
  const totalKzt = itemsTotalKzt + deliveryFeeKzt;
  if (!Number.isSafeInteger(totalKzt)) throw fail("AMOUNT_OVERFLOW", "Order total is outside the supported range");
  const now = new Date().toISOString();
  const order = {
    id: "SAM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
    customerId, productId: product.id, productName: product.name, quantity,
    fulfillment, address, deliveryZone, currency: CURRENCY,
    unitPriceKzt: product.priceKzt, itemsTotalKzt, deliveryFeeKzt, totalKzt,
    paymentStatus: "AWAITING_PAYMENT", status: "AWAITING_PAYMENT",
    courierId: null, paymentProvider: null, paymentReference: null,
    proof: null, createdAt: now, updatedAt: now
  };
  const orders = readOrders();
  orders.push(order);
  writeJson(ORDERS_FILE, orders);
  return order;
}
function updateOrder(id, mutate) {
  const orders = readOrders();
  const i = orders.findIndex((o) => o.id === String(id));
  if (i < 0) throw fail("ORDER_NOT_FOUND", "Order not found");
  const next = mutate({ ...orders[i] });
  next.updatedAt = new Date().toISOString();
  orders[i] = next;
  writeJson(ORDERS_FILE, orders);
  return next;
}
function applyVerifiedPayment(input) {
  if (input?.verified !== true) throw fail("PAYMENT_NOT_VERIFIED", "Payment must be verified by the payment provider");
  const eventId = String(input.eventId || "").trim();
  const orderId = String(input.orderId || "").trim();
  if (!eventId || !orderId) throw fail("PAYMENT_REFERENCE_REQUIRED", "Provider event ID and order ID are required");
  if (!Number.isSafeInteger(input.amountKzt) || input.amountKzt < 0) throw fail("INVALID_PAYMENT_AMOUNT", "Invalid payment amount");
  const currency = String(input.currency || "").toUpperCase();
  const events = readEvents();
  if (events.includes(eventId)) return { duplicate: true, order: getOrder(orderId) };
  const order = getOrder(orderId);
  if (!order) throw fail("ORDER_NOT_FOUND", "Order not found");
  if (order.paymentStatus === "PAID") {
    if (order.totalKzt !== input.amountKzt || order.currency !== currency) throw fail("PAYMENT_MISMATCH", "Payment does not match the order");
    events.push(eventId); writeJson(EVENTS_FILE, events);
    return { duplicate: true, order };
  }
  if (order.totalKzt !== input.amountKzt || order.currency !== currency) throw fail("PAYMENT_MISMATCH", "Payment amount or currency does not match the order");
  if (order.checkoutSessionId && input.sessionId !== order.checkoutSessionId) throw fail("PAYMENT_SESSION_MISMATCH", "Payment session does not match the order");
  const updated = updateOrder(orderId, (o) => ({
    ...o, paymentStatus: "PAID", status: o.fulfillment === "delivery" ? "PAID" : "READY_FOR_PICKUP",
    paymentProvider: String(input.provider || "unknown"), paymentReference: eventId, paidAt: new Date().toISOString()
  }));
  events.push(eventId); writeJson(EVENTS_FILE, events);
  return { duplicate: false, order: updated };
}
function assignCourier(orderId, courierId) {
  const id = String(courierId || "").trim();
  if (!id) throw fail("COURIER_REQUIRED", "Courier ID is required");
  return updateOrder(orderId, (o) => {
    if (o.fulfillment !== "delivery") throw fail("NOT_DELIVERY", "Pickup orders cannot be assigned to a courier");
    if (o.paymentStatus !== "PAID") throw fail("PAYMENT_NOT_CONFIRMED", "Courier dispatch is blocked until payment is confirmed");
    if (o.status === "DELIVERED" || o.status === "CANCELLED") throw fail("ORDER_CLOSED", "Order is closed");
    if (o.courierId && o.courierId !== id) throw fail("COURIER_ALREADY_ASSIGNED", "Order is already assigned");
    return { ...o, courierId: id, status: "COURIER_ASSIGNED" };
  });
}
function markInDelivery(orderId, courierId) {
  return updateOrder(orderId, (o) => {
    if (o.courierId !== String(courierId)) throw fail("FORBIDDEN", "Order is assigned to another courier");
    if (!["COURIER_ASSIGNED", "IN_DELIVERY"].includes(o.status)) throw fail("INVALID_ORDER_STATE", "Order is not ready for delivery");
    return { ...o, status: "IN_DELIVERY" };
  });
}
function attachProof(orderId, courierId, proof) {
  const fileId = String(proof?.telegramFileId || "").trim();
  if (!fileId) throw fail("PHOTO_REQUIRED", "Telegram photo file ID is required");
  const latitude = proof.latitude == null ? null : Number(proof.latitude);
  const longitude = proof.longitude == null ? null : Number(proof.longitude);
  if ((latitude == null) !== (longitude == null) ||
      (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
       !Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    throw fail("INVALID_LOCATION", "GPS coordinates must be a valid latitude/longitude pair");
  }
  return updateOrder(orderId, (o) => {
    if (o.courierId !== String(courierId)) throw fail("FORBIDDEN", "Order is assigned to another courier");
    if (o.paymentStatus !== "PAID") throw fail("PAYMENT_NOT_CONFIRMED", "Cannot submit delivery proof before payment is confirmed");
    if (!["COURIER_ASSIGNED", "IN_DELIVERY", "PHOTO_RECEIVED"].includes(o.status)) throw fail("INVALID_ORDER_STATE", "Order is not in a deliverable state");
    return { ...o, proof: { telegramFileId: fileId, latitude, longitude, receivedAt: new Date().toISOString() }, status: "PHOTO_RECEIVED" };
  });
}
function markDelivered(orderId, courierId) {
  return updateOrder(orderId, (o) => {
    if (o.courierId !== String(courierId)) throw fail("FORBIDDEN", "Order is assigned to another courier");
    if (o.status !== "PHOTO_RECEIVED") throw fail("PHOTO_REQUIRED", "Delivery proof photo is required before completion");
    return { ...o, status: "DELIVERED", deliveredAt: new Date().toISOString() };
  });
}
async function createCheckoutSession(orderId) {
  const secret = String(process.env.STRIPE_SECRET_KEY || "");
  if (!secret.startsWith("sk_test_")) throw fail("TEST_STRIPE_KEY_REQUIRED", "Configure a Stripe test secret key (sk_test_...) before creating checkout");
  const successUrl = String(process.env.COMMERCE_SUCCESS_URL || "");
  const cancelUrl = String(process.env.COMMERCE_CANCEL_URL || "");
  if (!/^https?:\/\//i.test(successUrl) || !/^https?:\/\//i.test(cancelUrl)) throw fail("CHECKOUT_URLS_REQUIRED", "Set COMMERCE_SUCCESS_URL and COMMERCE_CANCEL_URL");
  const order = getOrder(orderId);
  if (!order) throw fail("ORDER_NOT_FOUND", "Order not found");
  if (order.paymentStatus === "PAID") throw fail("ALREADY_PAID", "Order is already paid");
  if (order.checkoutSessionId && order.checkoutUrl) return { order, sessionId: order.checkoutSessionId, url: order.checkoutUrl };
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", order.id);
  form.set("metadata[order_id]", order.id);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", order.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(order.totalKzt));
  form.set("line_items[0][price_data][product_data][name]", order.productName.slice(0, 200));
  form.set("line_items[0][price_data][product_data][description]", (order.fulfillment === "delivery" ? "Доставка: " + order.deliveryZone + ". " : "Самовывоз. ") + "Заказ " + order.id);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id || !payload.url) {
    const error = fail("PAYMENT_PROVIDER_UNAVAILABLE", "Stripe test checkout could not be created");
    error.providerStatus = response.status;
    throw error;
  }
  const updated = updateOrder(order.id, (o) => {
    if (o.paymentStatus === "PAID") throw fail("ALREADY_PAID", "Order is already paid");
    return { ...o, checkoutSessionId: payload.id, checkoutUrl: payload.url, paymentProvider: "stripe_test" };
  });
  return { order: updated, sessionId: payload.id, url: payload.url };
}
function resetForTests() {
  for (const file of [ORDERS_FILE, EVENTS_FILE]) try { fs.unlinkSync(file); } catch {}
}
module.exports = { getCatalog, getDeliveryZones, getOrder, listOrders, createOrder, createCheckoutSession, applyVerifiedPayment, assignCourier, markInDelivery, attachProof, markDelivered, resetForTests };
