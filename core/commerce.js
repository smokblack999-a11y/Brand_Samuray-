"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const SKU_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORDER_RE = /^ord_[a-f0-9]{24}$/;
const STRIPE_SESSION_RE = /^cs_test_[A-Za-z0-9]+$/;
const STRIPE_EVENT_RE = /^evt_[A-Za-z0-9]+$/;
const CUSTOMER_RE = /^[a-zA-Z0-9_:@.-]{1,100}$/;
const CURRENCIES = new Set(["KZT", "USD", "EUR"]);
const STATUSES = new Set(["pending_payment", "fulfilled", "test_paid", "cancelled"]);

function commerceError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validateProduct(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw commerceError("INVALID_PRODUCT");
  if (typeof input.sku !== "string" || !SKU_RE.test(input.sku)) throw commerceError("INVALID_SKU");
  if (!text(input.name, 120)) throw commerceError("INVALID_PRODUCT_NAME");
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1) throw commerceError("INVALID_PRICE");
  if (!CURRENCIES.has(input.currency)) throw commerceError("INVALID_CURRENCY");
  if (!["digital", "physical"].includes(input.type)) throw commerceError("INVALID_PRODUCT_TYPE");
  if (!Number.isSafeInteger(input.stock) || input.stock < 0) throw commerceError("INVALID_STOCK");
  if (input.type === "digital" && !text(input.deliveryText, 2000)) throw commerceError("DIGITAL_DELIVERY_REQUIRED");
  return {
    sku: input.sku,
    name: text(input.name, 120),
    description: text(input.description, 1000),
    type: input.type,
    priceMinor: input.priceMinor,
    currency: input.currency,
    stock: input.stock,
    active: input.active !== false,
    deliveryText: input.type === "digital" ? text(input.deliveryText, 2000) : "",
    physicalInstructions: input.type === "physical" ? text(input.physicalInstructions, 1000) : ""
  };
}

function rememberStripeEvent(state, eventId) {
  state.stripeEventIds.push(eventId);
  // Keep the local demo store bounded. Order status remains the second idempotency guard.
  if (state.stripeEventIds.length > 10000) state.stripeEventIds.splice(0, state.stripeEventIds.length - 10000);
}

function validateOrder(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw commerceError("INVALID_STATE_ORDER");
  if (typeof input.id !== "string" || !ORDER_RE.test(input.id)) throw commerceError("INVALID_STATE_ORDER_ID");
  if (typeof input.customerId !== "string" || !CUSTOMER_RE.test(input.customerId)) throw commerceError("INVALID_STATE_CUSTOMER");
  if (typeof input.sku !== "string" || !SKU_RE.test(input.sku)) throw commerceError("INVALID_STATE_SKU");
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) throw commerceError("INVALID_STATE_QUANTITY");
  if (!Number.isSafeInteger(input.totalMinor) || input.totalMinor < 1 || !CURRENCIES.has(input.currency)) throw commerceError("INVALID_STATE_TOTAL");
  if (!STATUSES.has(input.status)) throw commerceError("INVALID_STATE_STATUS");
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) throw commerceError("INVALID_STATE_DATE");
  if (["fulfilled", "test_paid"].includes(input.status) && !input.fulfillment) throw commerceError("INVALID_STATE_FULFILLMENT");
  if (input.stripeCheckout !== undefined) {
    const checkout = input.stripeCheckout;
    let url;
    try { url = new URL(checkout?.url); } catch { throw commerceError("INVALID_STATE_STRIPE_CHECKOUT"); }
    if (!checkout || typeof checkout !== "object" || !STRIPE_SESSION_RE.test(String(checkout.sessionId || "")) ||
        checkout.livemode !== false || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" ||
        typeof checkout.createdAt !== "string" || !Number.isFinite(Date.parse(checkout.createdAt)) ||
        (checkout.expiresAt !== null && checkout.expiresAt !== undefined && !Number.isFinite(Date.parse(checkout.expiresAt)))) {
      throw commerceError("INVALID_STATE_STRIPE_CHECKOUT");
    }
  }
  return structuredClone(input);
}

function publicProduct(product) {
  const { deliveryText, ...safe } = product;
  const divisor = product.currency === "KZT" ? 1 : 100;
  const decimals = product.currency === "KZT" ? 0 : 2;
  return { ...safe, price: `${(product.priceMinor / divisor).toFixed(decimals)} ${product.currency}`, available: product.stock > 0 };
}

class CommerceStore {
  constructor({ dataDir, catalogFile, mode = "test" } = {}) {
    if (!dataDir) throw commerceError("DATA_DIR_REQUIRED");
    this.dataDir = path.resolve(dataDir);
    this.catalogFile = catalogFile ? path.resolve(catalogFile) : null;
    this.stateFile = path.join(this.dataDir, "commerce.json");
    this.mode = mode;
    this.state = { mode: "test", products: [], orders: [], stripeEventIds: [] };
    this.queue = Promise.resolve();
    this.initialized = false;
  }

  async init() {
    if (this.mode !== "test") throw commerceError("REAL_PAYMENTS_NOT_IMPLEMENTED", "Commerce supports test mode only; real payment processing is not implemented");
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw commerceError("STATE_READ_FAILED", "Commerce state cannot be read or parsed");
    }

    if (raw !== undefined) {
      if (!raw || raw.mode !== "test" || !Array.isArray(raw.products) || !Array.isArray(raw.orders)) throw commerceError("INVALID_STATE_SHAPE");
      const products = raw.products.map(validateProduct);
      const orders = raw.orders.map(validateOrder);
      if (new Set(products.map(p => p.sku)).size !== products.length) throw commerceError("DUPLICATE_STATE_SKU");
      if (new Set(orders.map(o => o.id)).size !== orders.length) throw commerceError("DUPLICATE_STATE_ORDER");
      const productBySku = new Map(products.map(p => [p.sku, p]));
      for (const order of orders) if (!productBySku.has(order.sku)) throw commerceError("ORPHANED_STATE_ORDER");
      const stripeEventIds = raw.stripeEventIds === undefined ? [] : raw.stripeEventIds;
      if (!Array.isArray(stripeEventIds) || stripeEventIds.some(id => typeof id !== "string" || !STRIPE_EVENT_RE.test(id)) || new Set(stripeEventIds).size !== stripeEventIds.length) {
        throw commerceError("INVALID_STATE_STRIPE_EVENTS");
      }
      this.state = { mode: "test", products, orders, stripeEventIds };
    } else {
      if (!this.catalogFile) throw commerceError("CATALOG_REQUIRED");
      let catalog;
      try { catalog = JSON.parse(await fs.readFile(this.catalogFile, "utf8")); }
      catch (_error) { throw commerceError("CATALOG_READ_FAILED", "Commerce catalog cannot be read or parsed"); }
      if (!catalog || catalog.mode !== "test" || !Array.isArray(catalog.products)) throw commerceError("INVALID_CATALOG");
      const products = catalog.products.map(validateProduct);
      if (new Set(products.map(p => p.sku)).size !== products.length) throw commerceError("DUPLICATE_CATALOG_SKU");
      this.state = { mode: "test", products, orders: [], stripeEventIds: [] };
      await this.#persist(this.state);
    }
    this.initialized = true;
    return this;
  }

  #assertReady() {
    if (!this.initialized) throw commerceError("COMMERCE_NOT_READY");
    if (this.mode !== "test") throw commerceError("REAL_PAYMENTS_NOT_IMPLEMENTED");
  }

  async #persist(candidate) {
    const temp = `${this.stateFile}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    let handle;
    try {
      handle = await fs.open(temp, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temp, this.stateFile);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.rm(temp, { force: true }).catch(() => {});
      throw commerceError("STATE_WRITE_FAILED", "Commerce state could not be persisted");
    }
  }

  #mutate(mutator) {
    const run = this.queue.then(async () => {
      this.#assertReady();
      const candidate = structuredClone(this.state);
      const result = await mutator(candidate);
      await this.#persist(candidate);
      this.state = candidate;
      return structuredClone(result);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  listProducts() {
    this.#assertReady();
    return this.state.products.filter(p => p.active).map(publicProduct);
  }

  async createOrder({ sku, quantity = 1, customerId }) {
    if (typeof sku !== "string" || !SKU_RE.test(sku)) throw commerceError("INVALID_SKU");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw commerceError("INVALID_QUANTITY");
    if (typeof customerId !== "string" || !CUSTOMER_RE.test(customerId)) throw commerceError("INVALID_CUSTOMER_ID");
    return this.#mutate(state => {
      const product = state.products.find(p => p.sku === sku && p.active);
      if (!product) throw commerceError("PRODUCT_NOT_FOUND");
      if (product.stock < quantity) throw commerceError("INSUFFICIENT_STOCK");
      const totalMinor = product.priceMinor * quantity;
      if (!Number.isSafeInteger(totalMinor)) throw commerceError("TOTAL_OVERFLOW");
      product.stock -= quantity;
      const order = {
        id: `ord_${crypto.randomBytes(12).toString("hex")}`,
        customerId,
        sku,
        productName: product.name,
        productType: product.type,
        quantity,
        unitPriceMinor: product.priceMinor,
        totalMinor,
        currency: product.currency,
        status: "pending_payment",
        createdAt: new Date().toISOString(),
        fulfillment: null
      };
      state.orders.push(order);
      return order;
    });
  }

  getOrder(id, customerId) {
    this.#assertReady();
    if (typeof id !== "string" || !ORDER_RE.test(id) || typeof customerId !== "string") return null;
    const order = this.state.orders.find(o => o.id === id && o.customerId === customerId);
    return order ? structuredClone(order) : null;
  }

  async recordStripeCheckout(id, customerId, session) {
    if (typeof id !== "string" || !ORDER_RE.test(id) || typeof customerId !== "string") throw commerceError("ORDER_NOT_FOUND");
    let url;
    try { url = new URL(session?.url); } catch { throw commerceError("STRIPE_SESSION_INVALID"); }
    if (!session || !STRIPE_SESSION_RE.test(String(session.id || "")) || session.livemode !== false ||
        url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
      throw commerceError("STRIPE_SESSION_INVALID");
    }
    const now = new Date().toISOString();
    const expiresAt = Number.isSafeInteger(session.expires_at) && session.expires_at > 0
      ? new Date(session.expires_at * 1000).toISOString()
      : null;
    return this.#mutate(state => {
      const order = state.orders.find(o => o.id === id && o.customerId === customerId);
      if (!order) throw commerceError("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw commerceError("ORDER_CANCELLED");
      if (["fulfilled", "test_paid"].includes(order.status)) throw commerceError("ORDER_ALREADY_FULFILLED");
      if (order.stripeCheckout) {
        if (order.stripeCheckout.sessionId === session.id) return order;
        throw commerceError("STRIPE_SESSION_ALREADY_ATTACHED");
      }
      order.stripeCheckout = {
        sessionId: session.id,
        url: session.url,
        livemode: false,
        createdAt: now,
        expiresAt
      };
      return order;
    });
  }

  async markStripePaid({ orderId, sessionId, eventId, metadataOrderId, metadataCustomerId, clientReferenceId, amountTotal, currency, paymentStatus, livemode }) {
    if (typeof orderId !== "string" || !ORDER_RE.test(orderId) || !STRIPE_SESSION_RE.test(String(sessionId || "")) || !STRIPE_EVENT_RE.test(String(eventId || ""))) {
      throw commerceError("STRIPE_EVENT_INVALID");
    }
    if (livemode !== false) throw commerceError("STRIPE_LIVE_EVENT_REJECTED");
    if (paymentStatus !== "paid") throw commerceError("STRIPE_PAYMENT_NOT_PAID");
    return this.#mutate(state => {
      const order = state.orders.find(o => o.id === orderId);
      if (state.stripeEventIds.includes(eventId)) return { duplicate: true, order: order || null };
      if (!order || metadataOrderId !== order.id || clientReferenceId !== order.id || metadataCustomerId !== order.customerId) {
        throw commerceError("STRIPE_ORDER_MISMATCH");
      }
      if (!order.stripeCheckout || order.stripeCheckout.sessionId !== sessionId) throw commerceError("STRIPE_SESSION_MISMATCH");
      // CommerceStore treats KZT as whole tenge; Stripe Checkout expects two-decimal KZT amounts.
      const expectedStripeAmount = order.currency === "KZT" ? order.totalMinor * 100 : order.totalMinor;
      if (!Number.isSafeInteger(expectedStripeAmount) || !Number.isSafeInteger(amountTotal) || amountTotal !== expectedStripeAmount || String(currency || "").toUpperCase() !== order.currency) {
        throw commerceError("STRIPE_AMOUNT_MISMATCH");
      }
      if (["fulfilled", "test_paid"].includes(order.status) && order.testPayment?.provider === "stripe_test") {
        rememberStripeEvent(state, eventId);
        return { duplicate: true, order };
      }
      if (["fulfilled", "test_paid"].includes(order.status)) throw commerceError("ORDER_ALREADY_FULFILLED");
      if (order.status !== "pending_payment") throw commerceError("ORDER_NOT_PENDING");
      const product = state.products.find(p => p.sku === order.sku);
      if (!product) throw commerceError("PRODUCT_NOT_FOUND");
      const fulfilledAt = new Date().toISOString();
      order.status = product.type === "digital" ? "fulfilled" : "test_paid";
      order.fulfillment = product.type === "digital"
        ? { kind: "demo_digital", content: product.deliveryText, fulfilledAt }
        : { kind: "demo_physical_request", instructions: product.physicalInstructions || "DEMO ONLY: no real shipment was created", fulfilledAt };
      order.testPayment = { simulated: false, testMode: true, provider: "stripe_test", eventId, sessionId, paidAt: fulfilledAt };
      rememberStripeEvent(state, eventId);
      return { duplicate: false, order };
    });
  }

  async cancelStripeCheckout({ orderId, sessionId, eventId, metadataOrderId, metadataCustomerId, livemode, reason = "checkout_expired" }) {
    if (typeof orderId !== "string" || !ORDER_RE.test(orderId) || !STRIPE_SESSION_RE.test(String(sessionId || "")) || !STRIPE_EVENT_RE.test(String(eventId || ""))) {
      throw commerceError("STRIPE_EVENT_INVALID");
    }
    if (livemode !== false) throw commerceError("STRIPE_LIVE_EVENT_REJECTED");
    return this.#mutate(state => {
      const order = state.orders.find(o => o.id === orderId);
      if (state.stripeEventIds.includes(eventId)) return { duplicate: true, order: order || null };
      if (!order || metadataOrderId !== order.id || metadataCustomerId !== order.customerId) throw commerceError("STRIPE_ORDER_MISMATCH");
      if (!order.stripeCheckout || order.stripeCheckout.sessionId !== sessionId) throw commerceError("STRIPE_SESSION_MISMATCH");
      if (order.status !== "pending_payment") {
        rememberStripeEvent(state, eventId);
        return { duplicate: true, order };
      }
      const product = state.products.find(p => p.sku === order.sku);
      if (!product) throw commerceError("PRODUCT_NOT_FOUND");
      product.stock += order.quantity;
      order.status = "cancelled";
      order.cancelledAt = new Date().toISOString();
      order.cancellationReason = reason;
      rememberStripeEvent(state, eventId);
      return { duplicate: false, order };
    });
  }

  async simulatePayment(id, customerId) {
    if (typeof id !== "string" || !ORDER_RE.test(id) || typeof customerId !== "string") throw commerceError("ORDER_NOT_FOUND");
    return this.#mutate(state => {
      const order = state.orders.find(o => o.id === id && o.customerId === customerId);
      if (!order) throw commerceError("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw commerceError("ORDER_CANCELLED");
      if (["fulfilled", "test_paid"].includes(order.status)) return order;
      const product = state.products.find(p => p.sku === order.sku);
      if (!product) throw commerceError("PRODUCT_NOT_FOUND");
      order.status = product.type === "digital" ? "fulfilled" : "test_paid";
      order.fulfillment = product.type === "digital"
        ? { kind: "demo_digital", content: product.deliveryText, fulfilledAt: new Date().toISOString() }
        : { kind: "demo_physical_request", instructions: product.physicalInstructions || "DEMO ONLY: no real shipment was created", fulfilledAt: new Date().toISOString() };
      order.testPayment = { simulated: true, provider: null, simulatedAt: new Date().toISOString() };
      return order;
    });
  }

  async cancelOrder(id, customerId) {
    if (typeof id !== "string" || !ORDER_RE.test(id) || typeof customerId !== "string") throw commerceError("ORDER_NOT_FOUND");
    return this.#mutate(state => {
      const order = state.orders.find(o => o.id === id && o.customerId === customerId);
      if (!order) throw commerceError("ORDER_NOT_FOUND");
      if (["fulfilled", "test_paid"].includes(order.status)) throw commerceError("ORDER_ALREADY_FULFILLED");
      if (order.status === "cancelled") return order;
      const product = state.products.find(p => p.sku === order.sku);
      if (!product) throw commerceError("PRODUCT_NOT_FOUND");
      product.stock += order.quantity;
      order.status = "cancelled";
      order.cancelledAt = new Date().toISOString();
      return order;
    });
  }
}

module.exports = { CommerceStore, commerceError, validateProduct };