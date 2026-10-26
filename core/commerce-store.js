"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const ORDER_ID = /^ord_[a-f0-9]{24}$/;
const SKU = /^[a-zA-Z0-9_-]{1,64}$/;
const CURRENCIES = new Set(["KZT", "USD", "EUR"]);

function publicProduct(product) {
  const { deliveryText, ...safe } = product;
  return { ...safe, available: product.stock > 0 };
}

function validateProduct(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("INVALID_CATALOG");
  if (typeof p.sku !== "string" || !SKU.test(p.sku)) throw new Error("INVALID_CATALOG_SKU");
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 120) throw new Error("INVALID_CATALOG_NAME");
  if (!Number.isSafeInteger(p.priceMinor) || p.priceMinor < 1) throw new Error("INVALID_CATALOG_PRICE");
  if (!CURRENCIES.has(p.currency)) throw new Error("INVALID_CATALOG_CURRENCY");
  if (!["digital", "physical"].includes(p.type)) throw new Error("INVALID_CATALOG_TYPE");
  if (!Number.isSafeInteger(p.stock) || p.stock < 0) throw new Error("INVALID_CATALOG_STOCK");
  if (p.type === "digital" && (typeof p.deliveryText !== "string" || !p.deliveryText.trim())) throw new Error("INVALID_CATALOG_DELIVERY");
  return {
    sku: p.sku, name: p.name.trim(), description: String(p.description || "").slice(0, 500),
    priceMinor: p.priceMinor, currency: p.currency, type: p.type, stock: p.stock,
    active: p.active !== false, deliveryText: p.type === "digital" ? p.deliveryText.slice(0, 2000) : "",
    physicalInstructions: String(p.physicalInstructions || "").slice(0, 500)
  };
}

class CommerceStore {
  constructor({ dataDir, catalogFile }) {
    this.file = path.join(dataDir, "commerce-state.json");
    this.catalogFile = catalogFile;
    this.products = new Map();
    this.orders = new Map();
    this.lock = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    let state;
    try { state = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("COMMERCE_STATE_INVALID"); }
    if (state) {
      if (state.mode !== "test" || !Array.isArray(state.products) || !Array.isArray(state.orders)) throw new Error("COMMERCE_STATE_INVALID");
      for (const p of state.products) this.products.set(p.sku, validateProduct(p));
      for (const o of state.orders) this.orders.set(o.id, o);
    } else {
      const catalog = JSON.parse(await fs.readFile(this.catalogFile, "utf8"));
      if (catalog.mode !== "test" || !Array.isArray(catalog.products)) throw new Error("COMMERCE_CATALOG_INVALID");
      for (const raw of catalog.products) {
        const p = validateProduct(raw);
        if (this.products.has(p.sku)) throw new Error("COMMERCE_DUPLICATE_SKU");
        this.products.set(p.sku, p);
      }
      await this.save();
    }
    return this;
  }

  async exclusive(fn) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }

  async save() {
    const tmp = this.file + "." + process.pid + ".tmp";
    const body = JSON.stringify({ mode: "test", products: [...this.products.values()], orders: [...this.orders.values()] }, null, 2);
    await fs.writeFile(tmp, body, { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  listProducts() {
    return [...this.products.values()].filter(p => p.active).map(publicProduct);
  }

  async createOrder({ sku, quantity, customerId }) {
    return this.exclusive(async () => {
      if (typeof sku !== "string" || !SKU.test(sku)) throw new Error("INVALID_SKU");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("INVALID_QUANTITY");
      if (typeof customerId !== "string" || !/^[a-zA-Z0-9_:-]{1,100}$/.test(customerId)) throw new Error("INVALID_CUSTOMER_ID");
      const p = this.products.get(sku);
      if (!p || !p.active) throw new Error("PRODUCT_NOT_FOUND");
      if (p.stock < quantity) throw new Error("OUT_OF_STOCK");
      const totalMinor = p.priceMinor * quantity;
      if (!Number.isSafeInteger(totalMinor)) throw new Error("TOTAL_OVERFLOW");
      p.stock -= quantity;
      const order = {
        id: "ord_" + crypto.randomBytes(12).toString("hex"), sku, productName: p.name,
        productType: p.type, quantity, unitPriceMinor: p.priceMinor, totalMinor, currency: p.currency,
        customerId, status: "awaiting_test_payment", paymentStatus: "unpaid", paymentMode: "test",
        createdAt: new Date().toISOString(), paidAt: null, fulfilledAt: null, delivery: null
      };
      this.orders.set(order.id, order);
      try { await this.save(); } catch (e) { p.stock += quantity; this.orders.delete(order.id); throw e; }
      return structuredClone(order);
    });
  }

  getOrder(id, customerId) {
    if (typeof id !== "string" || !ORDER_ID.test(id)) return null;
    const order = this.orders.get(id);
    if (!order || (customerId != null && order.customerId !== String(customerId))) return null;
    const { customerId: _owner, ...safe } = order;
    return structuredClone(safe);
  }

  async simulatePayment(id) {
    return this.exclusive(async () => {
      const o = this.orders.get(id);
      if (!o) throw new Error("ORDER_NOT_FOUND");
      if (o.paymentStatus === "paid") return this.publicOrder(o);
      if (o.status !== "awaiting_test_payment") throw new Error("ORDER_NOT_PAYABLE");
      const previous = structuredClone(o);
      o.paymentStatus = "paid";
      o.status = "paid_test";
      o.paidAt = new Date().toISOString();
      const p = this.products.get(o.sku);
      if (!p) throw new Error("PRODUCT_NOT_FOUND");
      o.delivery = o.productType === "digital"
        ? { kind: "digital_test", content: p.deliveryText, note: "DEMO ONLY — no real goods or license delivered." }
        : { kind: "physical_test", instructions: p.physicalInstructions || "Demo delivery request only.", note: "DEMO ONLY — no shipment created." };
      o.fulfilledAt = new Date().toISOString();
      o.status = "fulfilled_test";
      try { await this.save(); } catch (error) { this.orders.set(id, previous); throw error; }
      return this.publicOrder(o);
    });
  }

  async cancelOrder(id, customerId) {
    return this.exclusive(async () => {
      const o = this.orders.get(id);
      if (!o || o.customerId !== customerId) throw new Error("ORDER_NOT_FOUND");
      if (o.paymentStatus === "paid" || o.fulfilledAt) throw new Error("PAID_ORDER_CANNOT_BE_CANCELLED");
      if (o.status === "cancelled") return this.publicOrder(o);
      const previousOrder = structuredClone(o);
      const p = this.products.get(o.sku);
      const previousStock = p ? p.stock : null;
      if (p) p.stock += o.quantity;
      o.status = "cancelled";
      o.cancelledAt = new Date().toISOString();
      try { await this.save(); } catch (error) {
        this.orders.set(id, previousOrder);
        if (p) p.stock = previousStock;
        throw error;
      }
      return this.publicOrder(o);
    });
  }

  publicOrder(o) {
    const { customerId: _owner, ...safe } = o;
    return { ...structuredClone(safe), paymentMode: "test_only_no_money_moved" };
  }
}

module.exports = { CommerceStore };
