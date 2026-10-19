"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function fail(code, message) { const e = new Error(message); e.code = code; return e; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createCommerceService({ filePath }) {
  if (!filePath || typeof filePath !== "string") throw new Error("filePath is required");
  const resolvedPath = path.resolve(filePath);
  let state = { version: 1, products: [], orders: [], paymentEvents: [], outbox: [] };

  function validate(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.products) ||
        !Array.isArray(value.orders) || !Array.isArray(value.paymentEvents) || (value.outbox !== undefined && !Array.isArray(value.outbox))) {
      throw fail("COMMERCE_STATE_INVALID", "Commerce state is invalid; refusing to reset it");
    }
    return value;
  }
  function load() {
    if (!fs.existsSync(resolvedPath)) return;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")); }
    catch { throw fail("COMMERCE_STATE_CORRUPT", "Commerce state is unreadable; refusing to reset it"); }
    if (parsed && parsed.outbox === undefined) parsed.outbox = []; // Backward-compatible schema migration.
    state = validate(parsed);
  }
  function persist(next) {
    validate(next);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
    const temp = resolvedPath + "." + crypto.randomUUID() + ".tmp";
    let fd;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(next, null, 2) + "\n", "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, resolvedPath);
      try { fs.chmodSync(resolvedPath, 0o600); } catch {}
      state = next;
    } catch (error) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(temp); } catch {}
      throw error;
    }
  }
  load();
  function transact(mutator) {
    const next = clone(state);
    const result = mutator(next);
    persist(next);
    return clone(result);
  }
  function enqueue(next, type, order, now = new Date().toISOString()) {
    next.outbox.push({ eventId: crypto.randomUUID(), type, orderId: order.id, status: "pending", attempts: 0, createdAt: now, deliveredAt: null, lastError: null });
  }
  function productFields(data) {
    const name = String(data?.name || "").trim();
    const sku = String(data?.sku || "").trim();
    const priceKzt = Number(data?.priceKzt);
    const stock = Number(data?.stock);
    if (!name || name.length > 160) throw fail("INVALID_PRODUCT_NAME", "Product name required (max 160 chars)");
    if (!sku || sku.length > 80) throw fail("INVALID_SKU", "SKU required (max 80 chars)");
    if (!Number.isSafeInteger(priceKzt) || priceKzt < 0) throw fail("INVALID_PRICE", "priceKzt must be a non-negative integer");
    if (!Number.isSafeInteger(stock) || stock < 0) throw fail("INVALID_STOCK", "stock must be a non-negative integer");
    const description = String(data?.description || "").trim();
    if (description.length > 4000) throw fail("INVALID_DESCRIPTION", "Description too long");
    const media = Array.isArray(data?.media) ? data.media : [];
    if (media.length > 10 || media.some(m => !m || !["photo", "video"].includes(m.type) ||
        typeof m.url !== "string" || !/^https:\/\//i.test(m.url) || m.url.length > 2048)) {
      throw fail("INVALID_MEDIA", "Media must contain up to 10 HTTPS photo/video URLs");
    }
    return { name, sku, priceKzt, stock, description, media: clone(media), active: data?.active !== false };
  }
  function addProduct(data) {
    const fields = productFields(data);
    return transact(next => {
      if (next.products.some(p => p.sku.toLowerCase() === fields.sku.toLowerCase())) throw fail("SKU_EXISTS", "SKU already exists");
      const now = new Date().toISOString();
      const item = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
      next.products.push(item); return item;
    });
  }
  function updateProduct(productId, patch) {
    return transact(next => {
      const i = next.products.findIndex(p => p.id === productId);
      if (i < 0) throw fail("PRODUCT_NOT_FOUND", "Product not found");
      const current = next.products[i];
      const fields = productFields({ ...current, ...patch, priceKzt: patch?.priceKzt ?? current.priceKzt, stock: patch?.stock ?? current.stock });
      if (next.products.some(p => p.id !== productId && p.sku.toLowerCase() === fields.sku.toLowerCase())) throw fail("SKU_EXISTS", "SKU already exists");
      next.products[i] = { ...current, ...fields, updatedAt: new Date().toISOString() };
      return next.products[i];
    });
  }
  function listProducts({ includeInactive = false } = {}) {
    return clone(state.products.filter(p => includeInactive || p.active).sort((a,b) => a.name.localeCompare(b.name)));
  }
  function getOrder(orderId) { const o = state.orders.find(x => x.id === orderId); return o ? clone(o) : null; }

  function createOrder({ customerId, items, fulfilment, address = "", pickupPoint = "", phone = "", note = "" }) {
    if (customerId == null || !String(customerId).trim()) throw fail("CUSTOMER_REQUIRED", "customerId required");
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw fail("INVALID_ITEMS", "Order must contain 1–30 item lines");
    if (!["delivery", "pickup"].includes(fulfilment)) throw fail("INVALID_FULFILMENT", "fulfilment must be delivery or pickup");
    if (fulfilment === "delivery" && !String(address).trim()) throw fail("ADDRESS_REQUIRED", "Delivery address required");
    if (fulfilment === "pickup" && !String(pickupPoint).trim()) throw fail("PICKUP_POINT_REQUIRED", "Pickup point required");
    if (String(note).length > 1000 || String(address).length > 1000 || String(phone).length > 40) throw fail("ORDER_FIELD_TOO_LONG", "Order details too long");
    return transact(next => {
      const quantities = new Map();
      for (const row of items) {
        const id = String(row?.productId || ""), qty = Number(row?.quantity);
        if (!id || !Number.isSafeInteger(qty) || qty < 1 || qty > 100) throw fail("INVALID_QUANTITY", "Quantity must be an integer from 1 to 100");
        quantities.set(id, (quantities.get(id) || 0) + qty);
      }
      const lines = []; let totalKzt = 0;
      for (const [productId, quantity] of quantities) {
        const p = next.products.find(x => x.id === productId && x.active);
        if (!p) throw fail("PRODUCT_NOT_AVAILABLE", "Product is unavailable");
        if (p.stock < quantity) throw fail("INSUFFICIENT_STOCK", "Insufficient stock for SKU " + p.sku);
        const lineTotalKzt = p.priceKzt * quantity;
        if (!Number.isSafeInteger(lineTotalKzt) || !Number.isSafeInteger(totalKzt + lineTotalKzt)) throw fail("ORDER_TOTAL_OVERFLOW", "Order total too large");
        lines.push({ productId, sku: p.sku, name: p.name, unitPriceKzt: p.priceKzt, quantity, lineTotalKzt });
        totalKzt += lineTotalKzt;
      }
      for (const line of lines) next.products.find(p => p.id === line.productId).stock -= line.quantity;
      const now = new Date().toISOString();
      const order = {
        id: "SAM-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
        customerId: String(customerId), items: lines, fulfilment,
        address: fulfilment === "delivery" ? String(address).trim() : "",
        pickupPoint: fulfilment === "pickup" ? String(pickupPoint).trim() : "",
        phone: String(phone).trim(), note: String(note).trim(),
        subtotalKzt: totalKzt, deliveryFeeKzt: 0, totalKzt,
        payment: { status: "pending", method: null, eventId: null, confirmedAt: null },
        status: "pending_payment", courierId: null, deliveryProof: null, createdAt: now, updatedAt: now
      };
      next.orders.push(order); enqueue(next, "OrderPlaced", order, now); return order;
    });
  }
  function confirmPayment({ orderId, eventId, amountKzt, method, trusted = false }) {
    if (!trusted) throw fail("PAYMENT_NOT_VERIFIED", "A receipt image is not proof; trusted provider/bank confirmation required");
    if (!String(eventId || "").trim()) throw fail("PAYMENT_EVENT_REQUIRED", "Unique payment eventId required");
    if (!["provider_webhook", "bank_api", "manual_review"].includes(method)) throw fail("INVALID_PAYMENT_METHOD", "Unsupported payment confirmation method");
    return transact(next => {
      const prior = next.paymentEvents.find(e => e.eventId === String(eventId));
      if (prior) {
        if (prior.orderId !== orderId) throw fail("PAYMENT_EVENT_CONFLICT", "Payment event belongs to another order");
        return { order: next.orders.find(o => o.id === orderId), duplicate: true };
      }
      const order = next.orders.find(o => o.id === orderId);
      if (!order) throw fail("ORDER_NOT_FOUND", "Order not found");
      if (order.payment.status === "paid") throw fail("ORDER_ALREADY_PAID", "Order already paid");
      if (order.status !== "pending_payment") throw fail("INVALID_ORDER_STATE", "Order is not awaiting payment");
      if (!Number.isSafeInteger(Number(amountKzt)) || Number(amountKzt) !== order.totalKzt) throw fail("PAYMENT_AMOUNT_MISMATCH", "Payment amount does not match order total");
      const now = new Date().toISOString();
      order.payment = { status: "paid", method, eventId: String(eventId), confirmedAt: now };
      order.status = order.fulfilment === "pickup" ? "preparing" : "paid";
      order.updatedAt = now;
      next.paymentEvents.push({ eventId: String(eventId), orderId, amountKzt: Number(amountKzt), method, receivedAt: now });
      enqueue(next, "PaymentConfirmed", order, now);
      if (next.paymentEvents.length > 5000) next.paymentEvents = next.paymentEvents.slice(-5000);
      return { order, duplicate: false };
    }).order;
  }
  function assignCourier({ orderId, courierId }) {
    if (!String(courierId || "").trim()) throw fail("COURIER_REQUIRED", "courierId required");
    return transact(next => {
      const o = next.orders.find(x => x.id === orderId);
      if (!o) throw fail("ORDER_NOT_FOUND", "Order not found");
      if (o.fulfilment !== "delivery" || !["paid", "preparing", "assigned"].includes(o.status)) throw fail("INVALID_ORDER_STATE", "Only paid delivery orders can be assigned");
      o.courierId = String(courierId); o.status = "assigned"; o.updatedAt = new Date().toISOString(); enqueue(next, "CourierAssigned", o, o.updatedAt); return o;
    });
  }
  function startDelivery({ orderId, courierId }) {
    return transact(next => {
      const o = next.orders.find(x => x.id === orderId);
      if (!o) throw fail("ORDER_NOT_FOUND", "Order not found");
      if (o.courierId !== String(courierId) || o.status !== "assigned") throw fail("INVALID_ORDER_STATE", "Courier/order assignment mismatch");
      o.status = "out_for_delivery"; o.updatedAt = new Date().toISOString(); enqueue(next, "DeliveryStarted", o, o.updatedAt); return o;
    });
  }
  function markReadyForPickup({ orderId }) {
    return transact(next => {
      const o = next.orders.find(x => x.id === orderId);
      if (!o) throw fail("ORDER_NOT_FOUND", "Order not found");
      if (o.fulfilment !== "pickup" || o.status !== "preparing") throw fail("INVALID_ORDER_STATE", "Order is not being prepared for pickup");
      o.status = "ready_for_pickup"; o.updatedAt = new Date().toISOString(); enqueue(next, "PickupReady", o, o.updatedAt); return o;
    });
  }
  function confirmFulfilment({ orderId, actorId, photoUrl, note = "" }) {
    if (typeof photoUrl !== "string" || !/^https:\/\//i.test(photoUrl) || photoUrl.length > 2048) throw fail("INVALID_DELIVERY_PROOF", "Secure HTTPS photo URL required");
    return transact(next => {
      const o = next.orders.find(x => x.id === orderId);
      if (!o) throw fail("ORDER_NOT_FOUND", "Order not found");
      if (o.fulfilment === "delivery") {
        if (o.courierId !== String(actorId) || o.status !== "out_for_delivery") throw fail("INVALID_ORDER_STATE", "Only assigned courier can confirm active delivery");
        o.status = "delivered";
      } else {
        if (o.status !== "ready_for_pickup" || String(actorId) !== o.customerId) throw fail("INVALID_ORDER_STATE", "Pickup must be ready and confirmed by customer");
        o.status = "picked_up";
      }
      o.deliveryProof = { photoUrl, note: String(note).slice(0, 500), actorId: String(actorId), capturedAt: new Date().toISOString() };
      o.updatedAt = new Date().toISOString(); enqueue(next, o.status === "delivered" ? "OrderDelivered" : "OrderPickedUp", o, o.updatedAt); return o;
    });
  }
  function cancelOrder({ orderId, actorId, isAdmin = false }) {
    return transact(next => {
      const o = next.orders.find(x => x.id === orderId);
      if (!o) throw fail("ORDER_NOT_FOUND", "Order not found");
      if (!isAdmin && o.customerId !== String(actorId)) throw fail("FORBIDDEN", "Only customer or admin can cancel");
      if (!["pending_payment", "paid", "preparing", "ready_for_pickup"].includes(o.status)) throw fail("INVALID_ORDER_STATE", "Order cannot be cancelled at this stage");
      if (o.payment.status === "paid") throw fail("REFUND_REQUIRED", "Paid order needs a separate refund workflow");
      for (const line of o.items) { const p = next.products.find(x => x.id === line.productId); if (p) p.stock += line.quantity; }
      o.status = "cancelled"; o.updatedAt = new Date().toISOString(); enqueue(next, "OrderCancelled", o, o.updatedAt); return o;
    });
  }
  function listOutbox({ limit = 100, includeDeadLetter = false } = {}) {
    const bounded = Math.max(1, Math.min(500, Number.isSafeInteger(Number(limit)) ? Number(limit) : 100));
    const eligible = state.outbox.filter(e => e.status === "pending" || (includeDeadLetter && e.status === "dead_letter"));
    return clone(eligible.slice(0, bounded));
  }
  function markOutboxDelivered({ eventId }) {
    return transact(next => {
      const event = next.outbox.find(e => e.eventId === eventId);
      if (!event) throw fail("OUTBOX_EVENT_NOT_FOUND", "Outbox event not found");
      if (event.status !== "delivered") { event.status = "delivered"; event.deliveredAt = new Date().toISOString(); event.lastError = null; }
      return event;
    });
  }
  function markOutboxFailed({ eventId, error, maxAttempts = 8 }) {
    const attemptsLimit = Number.isSafeInteger(Number(maxAttempts)) ? Math.max(1, Math.min(100, Number(maxAttempts))) : 8;
    return transact(next => {
      const event = next.outbox.find(e => e.eventId === eventId);
      if (!event) throw fail("OUTBOX_EVENT_NOT_FOUND", "Outbox event not found");
      if (event.status !== "delivered" && event.status !== "dead_letter") {
        event.attempts += 1;
        event.lastError = String(error || "Delivery failed").slice(0, 500);
        event.lastAttemptAt = new Date().toISOString();
        event.status = event.attempts >= attemptsLimit ? "dead_letter" : "pending";
        if (event.status === "dead_letter") event.deadLetteredAt = event.lastAttemptAt;
      }
      return event;
    });
  }
  return { addProduct, updateProduct, listProducts, createOrder, getOrder, confirmPayment, assignCourier, startDelivery, confirmFulfilment, markReadyForPickup, cancelOrder, listOutbox, markOutboxDelivered, markOutboxFailed };
}
module.exports = { createCommerceService };
