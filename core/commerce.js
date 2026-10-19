"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "commerce.json");
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || "test").trim().toLowerCase();
if (PAYMENT_MODE !== "test") throw new Error("This build supports PAYMENT_MODE=test only; live payments are not implemented");

function readState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ products: [], orders: [] }, null, 2) + "\n");
  const state = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (!Array.isArray(state.products) || !Array.isArray(state.orders)) throw new Error("Commerce store has invalid shape");
  return state;
}
function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, FILE);
}
function publicProduct(product) {
  const { deliveryPayload, ...safe } = product;
  return safe;
}
function listProducts({ includeInactive = false } = {}) {
  return readState().products.filter(p => includeInactive || p.active).map(publicProduct);
}
function getProduct(sku) {
  const key = String(sku || "").trim().toUpperCase();
  return readState().products.find(p => p.sku === key) || null;
}
function upsertProduct(input) {
  const sku = String(input?.sku || "").trim().toUpperCase();
  const name = String(input?.name || "").trim();
  const type = String(input?.type || "").trim().toLowerCase();
  const priceMinor = Number(input?.priceMinor);
  const currency = String(input?.currency || "KZT").trim().toUpperCase();
  const stock = Number(input?.stock);
  if (!/^[A-Z0-9_-]{2,40}$/.test(sku)) throw coded("INVALID_SKU", "sku must be 2-40 letters, digits, _ or -");
  if (!name || name.length > 160) throw coded("INVALID_PRODUCT_NAME", "name is required and must be at most 160 characters");
  if (!["physical", "digital"].includes(type)) throw coded("INVALID_PRODUCT_TYPE", "type must be physical or digital");
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw coded("INVALID_PRICE", "priceMinor must be a non-negative integer in minor currency units");
  if (!/^[A-Z]{3}$/.test(currency)) throw coded("INVALID_CURRENCY", "currency must be a 3-letter ISO code");
  if (!Number.isSafeInteger(stock) || stock < 0) throw coded("INVALID_STOCK", "stock must be a non-negative integer");
  const deliveryPayload = String(input?.deliveryPayload || "").trim();
  if (type === "digital" && deliveryPayload.length > 8000) throw coded("DELIVERY_TOO_LONG", "digital delivery payload must be at most 8000 characters");
  const state = readState();
  const existing = state.products.find(p => p.sku === sku);
  const product = { sku, name, type, priceMinor, currency, stock, active: input?.active !== false, deliveryPayload: type === "digital" ? deliveryPayload : "", updatedAt: new Date().toISOString() };
  if (existing) Object.assign(existing, product); else state.products.push({ ...product, createdAt: new Date().toISOString() });
  writeState(state);
  return publicProduct(existing || state.products[state.products.length - 1]);
}
function availableStock(state, sku) {
  const product = state.products.find(p => p.sku === sku);
  if (!product) return 0;
  const pending = state.orders.filter(o => o.sku === sku && o.paymentStatus === "pending").reduce((sum, o) => sum + o.quantity, 0);
  return Math.max(0, product.stock - pending);
}
function createOrder({ sku, quantity = 1, customerId = null, chatId = null, eventKey = null } = {}) {
  const key = String(sku || "").trim().toUpperCase();
  const qty = Number(quantity);
  if (!/^[A-Z0-9_-]{2,40}$/.test(key)) throw coded("INVALID_SKU", "Valid sku is required");
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 20) throw coded("INVALID_QUANTITY", "quantity must be an integer from 1 to 20");
  const state = readState();
  if (eventKey) { const existing = state.orders.find(o => o.eventKey === String(eventKey)); if (existing) return { ...existing, duplicate: true }; }
  const product = state.products.find(p => p.sku === key && p.active);
  if (!product) throw coded("PRODUCT_NOT_FOUND", "Product not found or inactive");
  if (availableStock(state, key) < qty) throw coded("OUT_OF_STOCK", "Not enough stock available");
  const order = { id: `test_${crypto.randomBytes(8).toString("hex")}`, eventKey: eventKey ? String(eventKey) : null, sku: key, productName: product.name, type: product.type, quantity: qty, unitPriceMinor: product.priceMinor, totalMinor: product.priceMinor * qty, currency: product.currency, customerId: customerId == null ? null : String(customerId), chatId: chatId == null ? null : String(chatId), paymentMode: "test", paymentStatus: "pending", deliveryStatus: "pending", createdAt: new Date().toISOString() };
  state.orders.push(order);
  writeState(state);
  return { ...order };
}
function listOrders({ limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  return readState().orders.slice(-n).reverse().map(o => ({ ...o }));
}
function getOrder(id) {
  return readState().orders.find(o => o.id === String(id || "")) || null;
}
function markTestPaid(id) {
  if (PAYMENT_MODE !== "test") throw coded("TEST_PAYMENTS_DISABLED", "Only PAYMENT_MODE=test is supported by this build");
  const state = readState();
  const order = state.orders.find(o => o.id === String(id || ""));
  if (!order) throw coded("ORDER_NOT_FOUND", "Order not found");
  if (order.paymentStatus === "paid") return { order: { ...order }, alreadyPaid: true, delivery: order.deliveryPayload || null };
  if (order.paymentStatus !== "pending") throw coded("ORDER_NOT_PAYABLE", "Order is not pending payment");
  const product = state.products.find(p => p.sku === order.sku);
  if (!product || !product.active || product.stock < order.quantity) throw coded("OUT_OF_STOCK", "Product stock changed before test payment");
  product.stock -= order.quantity;
  order.paymentStatus = "paid";
  order.paidAt = new Date().toISOString();
  order.testPaymentReference = `TEST-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  if (order.type === "digital") {
    order.deliveryStatus = product.deliveryPayload ? "ready" : "missing_payload";
    order.deliveryPayload = product.deliveryPayload || "";
  } else {
    order.deliveryStatus = "fulfilment_required";
  }
  writeState(state);
  return { order: { ...order, deliveryPayload: undefined }, alreadyPaid: false, delivery: order.type === "digital" ? (product.deliveryPayload || null) : null };
}
function coded(code, message) { const error = new Error(message); error.code = code; return error; }

module.exports = { PAYMENT_MODE, listProducts, getProduct, upsertProduct, createOrder, listOrders, getOrder, markTestPaid };
