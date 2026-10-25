"use strict";

const crypto = require("node:crypto");
const {
  withTransaction,
  readOrders,
  writeOrders,
  readEvents,
  writeEvents,
  enqueuePaymentNotification,
  claimPendingOutboxJobs,
  completeOutboxJob,
  retryOutboxJob,
  listOutboxJobsForTests,
  resetForTests: resetStorageForTests
} = require("./commerce-storage");

const CURRENCY = String(process.env.COMMERCE_CURRENCY || "KZT").toUpperCase();

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
  })).filter((p) => /^[A-Za-z0-9_-]{1,32}$/.test(p.id) && p.name && p.name.length <= 200 && Number.isSafeInteger(p.priceKzt) && p.priceKzt > 0 && p.active);
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
function createOrderInternal(input) {
  const customerId = String(input.customerId || "").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  const productId = String(input.productId || "").trim();
  const quantity = input.quantity == null ? 1 : Number(input.quantity);
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
  if (idempotencyKey) {
    const existing = readOrders().find((o) => o.idempotencyKey === idempotencyKey);
    if (existing) {
      const sameRequest = existing.customerId === customerId &&
        existing.productId === product.id &&
        existing.quantity === quantity &&
        existing.fulfillment === fulfillment &&
        (existing.address || null) === address &&
        (existing.deliveryZone || null) === deliveryZone;
      if (!sameRequest) throw fail("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different order request");
      return existing;
    }
  }
  const now = new Date().toISOString();
  const order = {
    id: "SAM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
    customerId, productId: product.id, productName: product.name, quantity, idempotencyKey: idempotencyKey || null,
    fulfillment, address, deliveryZone, currency: CURRENCY,
    unitPriceKzt: product.priceKzt, itemsTotalKzt, deliveryFeeKzt, totalKzt,
    paymentStatus: "AWAITING_PAYMENT", status: "AWAITING_PAYMENT",
    courierId: null, paymentProvider: null, paymentReference: null, paymentEventIds: [], checkoutSessionIds: [],
    proof: null, notifications: { customerSentAt: null, courierSentIds: [], adminSentIds: [], deliveryEscalatedAt: null }, createdAt: now, updatedAt: now
  };
  const orders = readOrders();
  orders.push(order);
  writeOrders(orders);
  return order;
}
function createOrder(input) {
  return withTransaction(() => createOrderInternal(input));
}
function updateOrder(id, mutate) {
  return withTransaction(() => {
    const orders = readOrders();
    const i = orders.findIndex((o) => o.id === String(id));
    if (i < 0) throw fail("ORDER_NOT_FOUND", "Order not found");
    const next = mutate({ ...orders[i] });
    next.updatedAt = new Date().toISOString();
    orders[i] = next;
    writeOrders(orders);
    return next;
  });
}
function applyVerifiedPaymentInternal(input) {
  if (input?.verified !== true) throw fail("PAYMENT_NOT_VERIFIED", "Payment must be verified by the payment provider");
  const eventId = String(input.eventId || "").trim();
  const orderId = String(input.orderId || "").trim();
  if (!eventId || !orderId) throw fail("PAYMENT_REFERENCE_REQUIRED", "Provider event ID and order ID are required");
  if (!Number.isSafeInteger(input.amountKzt) || input.amountKzt <= 0) throw fail("INVALID_PAYMENT_AMOUNT", "Invalid payment amount");
  const currency = String(input.currency || "").toUpperCase();
  const order = getOrder(orderId);
  if (!order) throw fail("ORDER_NOT_FOUND", "Order not found");
  const acceptedSessions = Array.isArray(order.checkoutSessionIds) ? order.checkoutSessionIds : (order.checkoutSessionId ? [order.checkoutSessionId] : []);
  if (!input.sessionId || !acceptedSessions.includes(input.sessionId)) throw fail("PAYMENT_SESSION_MISMATCH", "Payment session does not match the order");
  if (order.totalKzt !== input.amountKzt || order.currency !== currency) throw fail("PAYMENT_MISMATCH", "Payment amount or currency does not match the order");

  const events = readEvents();
  const orderEventIds = Array.isArray(order.paymentEventIds) ? order.paymentEventIds : [];
  const alreadyPaidForThisEvent = order.paymentStatus === "PAID" && order.paymentReference === eventId;
  const alreadyAppliedToOrder = orderEventIds.includes(eventId) || alreadyPaidForThisEvent;
  if (events.includes(eventId) && !alreadyAppliedToOrder) {
    throw fail("PAYMENT_EVENT_REPLAY_MISMATCH", "Provider event ID has already been used for a different order");
  }

  // A valid provider settlement must never reopen an order that is already closed.
  // Record the settlement for operator review instead of marking the order as paid.
  const closedUnpaidOrder = ["CANCELLED", "REFUNDED", "DELIVERED"].includes(order.status) &&
    order.paymentStatus !== "PAID";
  if (closedUnpaidOrder) {
    const incidents = Array.isArray(order.duplicatePaymentIncidents) ? order.duplicatePaymentIncidents : [];
    const existingIncident = incidents.find((item) =>
      item && (item.sessionId === String(input.sessionId) || item.eventId === eventId)
    ) || null;
    if (alreadyAppliedToOrder) {
      if (!events.includes(eventId)) { events.push(eventId); writeEvents(events); }
      return { duplicate: true, duplicatePayment: true, order, incident: existingIncident };
    }
    const incident = existingIncident || {
      eventId,
      sessionId: String(input.sessionId),
      amountKzt: input.amountKzt,
      currency,
      detectedAt: new Date().toISOString(),
      status: "REVIEW_REQUIRED",
      reason: "PAYMENT_AFTER_ORDER_CLOSED",
      adminNotifiedIds: []
    };
    const updated = updateOrder(orderId, (o) => ({
      ...o,
      paymentEventIds: [...new Set([...(Array.isArray(o.paymentEventIds) ? o.paymentEventIds : []), eventId])],
      duplicatePaymentIncidents: existingIncident
        ? (Array.isArray(o.duplicatePaymentIncidents) ? o.duplicatePaymentIncidents : [])
        : [...(Array.isArray(o.duplicatePaymentIncidents) ? o.duplicatePaymentIncidents : []), incident]
    }));
    if (!events.includes(eventId)) { events.push(eventId); writeEvents(events); }
    return { duplicate: true, duplicatePayment: true, order: updated, incident };
  }

  if (alreadyAppliedToOrder) {
    // Repair both ledgers if a prior process stopped between writes; this also migrates
    // pre-versioned paid orders that only stored paymentReference.
    if (!orderEventIds.includes(eventId)) {
      const repaired = updateOrder(orderId, (o) => ({
        ...o, paymentEventIds: [...(Array.isArray(o.paymentEventIds) ? o.paymentEventIds : []), eventId]
      }));
      if (!events.includes(eventId)) { events.push(eventId); writeEvents(events); }
      return { duplicate: true, order: repaired };
    }
    if (!events.includes(eventId)) { events.push(eventId); writeEvents(events); }
    if (order.paymentStatus !== "PAID") throw fail("PAYMENT_EVENT_STATE_MISMATCH", "Payment event is recorded but the order is not paid");
    return { duplicate: true, order };
  }
  if (order.paymentStatus === "PAID") {
    const alreadyPaidSessionId = order.paymentSessionId || order.checkoutSessionId || null;
    if (alreadyPaidSessionId !== input.sessionId) {
      // A different Checkout Session has also reported a completed payment for an already-paid order.
      // Preserve the first payment and create a reconciliation incident; never silently treat this
      // as an ordinary duplicate. Refund/reconciliation remains an explicit operator action.
      const incident = {
        eventId,
        sessionId: String(input.sessionId),
        amountKzt: input.amountKzt,
        currency,
        detectedAt: new Date().toISOString(),
        status: "REVIEW_REQUIRED",
        adminNotifiedIds: []
      };
      const updated = updateOrder(orderId, (o) => ({
        ...o,
        paymentEventIds: [...new Set([...(Array.isArray(o.paymentEventIds) ? o.paymentEventIds : []), eventId])],
        duplicatePaymentIncidents: [
          ...(Array.isArray(o.duplicatePaymentIncidents) ? o.duplicatePaymentIncidents : [])
            .filter((x) => x && x.sessionId !== incident.sessionId),
          incident
        ]
      }));
      events.push(eventId); writeEvents(events);
      return { duplicate: true, duplicatePayment: true, order: updated, incident };
    }
    const updated = updateOrder(orderId, (o) => ({
      ...o,
      paymentEventIds: [...new Set([...(Array.isArray(o.paymentEventIds) ? o.paymentEventIds : []), eventId])]
    }));
    events.push(eventId); writeEvents(events);
    return { duplicate: true, order: updated };
  }
  const updated = updateOrder(orderId, (o) => ({
    ...o,
    paymentStatus: "PAID",
    status: o.fulfillment === "delivery" ? "PAID" : "READY_FOR_PICKUP",
    paymentProvider: String(input.provider || "unknown"),
    paymentReference: eventId,
    paymentSessionId: String(input.sessionId),
    duplicatePaymentIncidents: Array.isArray(o.duplicatePaymentIncidents) ? o.duplicatePaymentIncidents : [],
    paymentEventIds: [...new Set([...(Array.isArray(o.paymentEventIds) ? o.paymentEventIds : []), eventId])],
    paidAt: new Date().toISOString()
  }));
  events.push(eventId);
  writeEvents(events);
  enqueuePaymentNotification(updated.id);
  return { duplicate: false, order: updated };
}
function applyVerifiedPayment(input) {
  return withTransaction(() => applyVerifiedPaymentInternal(input));
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
    if (o.proof?.customerSentAt && o.proof.telegramFileId !== fileId) throw fail("PHOTO_ALREADY_DELIVERED", "A different photo has already been delivered for this order");
    if (o.paymentStatus !== "PAID") throw fail("PAYMENT_NOT_CONFIRMED", "Cannot submit delivery proof before payment is confirmed");
    if (!["COURIER_ASSIGNED", "IN_DELIVERY", "PHOTO_RECEIVED"].includes(o.status)) throw fail("INVALID_ORDER_STATE", "Order is not in a deliverable state");
    return { ...o, proof: { telegramFileId: fileId, sha256: proof.sha256 || null, latitude, longitude, accuracyMeters: proof.accuracyMeters == null ? null : Number(proof.accuracyMeters), capturedAt: proof.capturedAt || null, receivedAt: new Date().toISOString(), customerSentAt: o.proof?.telegramFileId === fileId ? (o.proof.customerSentAt || null) : null }, status: "PHOTO_RECEIVED" };
  });
}
function markPhotoDelivered(orderId, courierId, telegramFileId) {
  const fileId = String(telegramFileId || "").trim();
  if (!fileId) throw fail("PHOTO_REQUIRED", "Telegram photo file ID is required");
  return updateOrder(orderId, (o) => {
    if (o.courierId !== String(courierId)) throw fail("FORBIDDEN", "Order is assigned to another courier");
    if (!o.proof || o.proof.telegramFileId !== fileId) throw fail("PHOTO_PROOF_MISMATCH", "Photo does not match the order proof");
    return { ...o, proof: { ...o.proof, customerSentAt: o.proof.customerSentAt || new Date().toISOString() } };
  });
}
function markDelivered(orderId, courierId) {
  return updateOrder(orderId, (o) => {
    if (o.courierId !== String(courierId)) throw fail("FORBIDDEN", "Order is assigned to another courier");
    if (o.status !== "PHOTO_RECEIVED" || !o.proof) throw fail("PHOTO_REQUIRED", "Delivery proof photo is required before completion");
    if (!o.proof.customerSentAt) throw fail("PHOTO_DELIVERY_PENDING", "Delivery photo must be delivered to the customer before completion");
    return { ...o, status: "DELIVERED", deliveredAt: new Date().toISOString() };
  });
}
async function createCheckoutSession(orderId) {
  const order = getOrder(orderId);
  if (!order) throw fail("ORDER_NOT_FOUND", "Order not found");
  if (["CANCELLED", "DELIVERED", "REFUNDED"].includes(order.status)) {
    throw fail("ORDER_CLOSED", "Closed orders cannot create a new Checkout session");
  }
  if (order.currency !== "KZT") throw fail("UNSUPPORTED_PAYMENT_CURRENCY", "Stripe test checkout is configured only for KZT");
  if (order.totalKzt > 999999) throw fail("PAYMENT_AMOUNT_LIMIT", "Order total exceeds the current Stripe KZT amount limit");
  const secret = String(process.env.STRIPE_SECRET_KEY || "");
  if (!secret.startsWith("sk_test_")) throw fail("TEST_STRIPE_KEY_REQUIRED", "Configure a Stripe test secret key (sk_test_...) before creating checkout");
  const successUrl = String(process.env.COMMERCE_SUCCESS_URL || "");
  const cancelUrl = String(process.env.COMMERCE_CANCEL_URL || "");
  if (!/^https?:\/\//i.test(successUrl) || !/^https?:\/\//i.test(cancelUrl)) throw fail("CHECKOUT_URLS_REQUIRED", "Set COMMERCE_SUCCESS_URL and COMMERCE_CANCEL_URL");
  if (order.paymentStatus === "PAID") throw fail("ALREADY_PAID", "Order is already paid");
  const previousExpired = Boolean(order.checkoutSessionId && (
    !order.checkoutSessionExpiresAt ||
    !Number.isFinite(Date.parse(order.checkoutSessionExpiresAt)) ||
    Date.parse(order.checkoutSessionExpiresAt) <= Date.now()
  ));
  const checkoutReusable = order.checkoutSessionId && order.checkoutUrl &&
    order.checkoutSessionExpiresAt &&
    Number.isFinite(Date.parse(order.checkoutSessionExpiresAt)) &&
    Date.parse(order.checkoutSessionExpiresAt) > Date.now();
  if (checkoutReusable) return { order, sessionId: order.checkoutSessionId, url: order.checkoutUrl };

  // Before creating a replacement, query Stripe for the old session. Its webhook may
  // be delayed; never hand out a second payable link until Stripe confirms expiry.
  if (previousExpired) {
    const oldSessionId = order.checkoutSessionId;
    const lookupResponse = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(oldSessionId), {
      method: "GET",
      headers: { Authorization: "Bearer " + secret, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const prior = await lookupResponse.json().catch(() => ({}));
    if (!lookupResponse.ok || prior.id !== oldSessionId) {
      throw fail("PAYMENT_STATUS_UNAVAILABLE", "The previous Checkout session could not be verified; no replacement link was created");
    }
    if (prior.livemode !== false || prior.mode !== "payment" ||
        prior.client_reference_id !== order.id || prior.metadata?.order_id !== order.id) {
      throw fail("PAYMENT_SESSION_MISMATCH", "The previous Checkout session does not match this test order");
    }
    if (prior.status === "complete" && prior.payment_status === "paid") {
      const amountMinor = Number(prior.amount_total);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor % 100 !== 0 ||
          amountMinor !== order.totalKzt * 100 || String(prior.currency || "").toUpperCase() !== order.currency) {
        throw fail("PAYMENT_MISMATCH", "The completed Checkout session does not match the order total");
      }
      const recovered = applyVerifiedPayment({
        verified: true,
        eventId: "stripe-session-reconcile:" + prior.id,
        orderId: order.id,
        sessionId: prior.id,
        amountKzt: amountMinor / 100,
        currency: String(prior.currency || "").toUpperCase(),
        provider: "stripe_test"
      });
      return { order: recovered.order, sessionId: prior.id, url: null, alreadyPaid: true };
    }
    if (prior.status !== "expired") {
      throw fail("PAYMENT_STATUS_PENDING", "The previous Checkout session is not confirmed expired; no replacement link was created");
    }
  }

  // The key is deterministic for the current checkout generation. Two simultaneous
  // retries therefore use the same Stripe idempotency key instead of creating two sessions.
  // A new generation is allowed only after the previous session is confirmed expired.
  const existingSessionIds = Array.isArray(order.checkoutSessionIds) ? order.checkoutSessionIds : [];
  const knownSessionIds = [...new Set([...existingSessionIds, ...(order.checkoutSessionId ? [order.checkoutSessionId] : [])])];
  const checkoutIdempotencyKey = "samurai-" + order.id + "-checkout-" + knownSessionIds.length;
  updateOrder(order.id, (o) => ({
    ...o,
    checkoutAttemptKey: checkoutIdempotencyKey,
    checkoutAttemptStartedAt: o.checkoutAttemptKey === checkoutIdempotencyKey ? o.checkoutAttemptStartedAt : new Date().toISOString(),
    ...(previousExpired ? {
      checkoutSessionId: null,
      checkoutUrl: null,
      checkoutSessionExpiresAt: null,
      checkoutSessionIds: [...new Set([...(Array.isArray(o.checkoutSessionIds) ? o.checkoutSessionIds : []), ...(o.checkoutSessionId ? [o.checkoutSessionId] : [])])]
    } : {})
  }));
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", order.id);
  form.set("metadata[order_id]", order.id);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", order.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(order.totalKzt * 100));
  form.set("line_items[0][price_data][product_data][name]", order.productName.slice(0, 200));
  form.set("line_items[0][price_data][product_data][description]", (order.fulfillment === "delivery" ? "Доставка: " + order.deliveryZone + ". " : "Самовывоз. ") + "Заказ " + order.id);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": checkoutIdempotencyKey },
    body: form,
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id || !payload.url) {
    const error = fail("PAYMENT_PROVIDER_UNAVAILABLE", "Stripe test checkout could not be created");
    error.providerStatus = response.status;
    throw error;
  }
  let checkoutUrl;
  try {
    checkoutUrl = new URL(payload.url);
  } catch {
    throw fail("PAYMENT_SESSION_INVALID", "Stripe returned an invalid Checkout URL");
  }
  const expectedMinorAmount = order.totalKzt * 100;
  if (!String(payload.id).startsWith("cs_test_") ||
      payload.livemode !== false ||
      payload.mode !== "payment" ||
      payload.status !== "open" ||
      payload.client_reference_id !== order.id ||
      payload.metadata?.order_id !== order.id ||
      String(payload.currency || "").toUpperCase() !== order.currency ||
      payload.amount_total !== expectedMinorAmount ||
      checkoutUrl.protocol !== "https:" ||
      checkoutUrl.hostname !== "checkout.stripe.com" ||
      !Number.isSafeInteger(payload.expires_at) ||
      payload.expires_at * 1000 <= Date.now()) {
    throw fail("PAYMENT_SESSION_INVALID", "Stripe Checkout response does not match the expected test order");
  }
  const updated = updateOrder(order.id, (o) => {
    if (o.paymentStatus === "PAID") throw fail("ALREADY_PAID", "Order is already paid");
    return { ...o, checkoutSessionId: payload.id, checkoutSessionIds: [...new Set([...(Array.isArray(o.checkoutSessionIds) ? o.checkoutSessionIds : []), payload.id])], checkoutUrl: checkoutUrl.toString(), checkoutSessionExpiresAt: new Date(payload.expires_at * 1000).toISOString(), paymentProvider: "stripe_test" };
  });
  // Cancellation may race with the external provider call. Persist the session for
  // reconciliation, but never return a payable URL for a now-closed order.
  if (["CANCELLED", "DELIVERED", "REFUNDED"].includes(updated.status)) {
    throw fail("ORDER_CLOSED", "Order was closed while Checkout was being created; session retained for reconciliation");
  }
  return { order: updated, sessionId: payload.id, url: payload.url };
}
function attachCheckoutSession(orderId, sessionId, checkoutUrl = "https://checkout.stripe.test/session") {
  if (!String(sessionId || "").startsWith("cs_test_")) throw fail("INVALID_CHECKOUT_SESSION", "Only a Stripe test Checkout Session is accepted");
  return updateOrder(orderId, (o) => ({ ...o, checkoutSessionId: String(sessionId), checkoutSessionIds: [...new Set([...(Array.isArray(o.checkoutSessionIds) ? o.checkoutSessionIds : []), String(sessionId)])], checkoutUrl, paymentProvider: "stripe_test" }));
}
function submitPaymentReceipt(orderId, customerId, receipt) {
  const ownerId = String(customerId || "").trim();
  const fileId = String(receipt?.telegramFileId || "").trim();
  if (!ownerId) throw fail("CUSTOMER_REQUIRED", "Customer Telegram ID is required");
  if (!fileId) throw fail("PAYMENT_RECEIPT_REQUIRED", "A Telegram receipt photo is required");
  return updateOrder(orderId, (o) => {
    if (o.customerId !== ownerId) throw fail("FORBIDDEN", "Only the order owner can submit a receipt");
    if (o.paymentStatus === "PAID" || ["DELIVERED", "CANCELLED"].includes(o.status)) {
      throw fail("ORDER_NOT_REVIEWABLE", "This order cannot accept a payment receipt");
    }
    const receipts = Array.isArray(o.paymentReceipts) ? o.paymentReceipts : [];
    if (receipts.some((x) => x && x.telegramFileId === fileId)) return o;
    const paymentReceipt = {
      telegramFileId: fileId,
      fileUniqueId: String(receipt.fileUniqueId || "").slice(0, 256) || null,
      submittedBy: ownerId,
      submittedAt: new Date().toISOString(),
      adminSentIds: []
    };
    return {
      ...o,
      paymentReceipts: [...receipts, paymentReceipt].slice(-10),
      status: "PAYMENT_REVIEW"
    };
  });
}

function reconcileManualBankPaymentInternal(orderId, adminId, bankReference) {
  const reviewer = String(adminId || "").trim();
  const reference = String(bankReference || "").trim();
  if (!/^\d{1,20}$/.test(reviewer)) throw fail("ADMIN_ID_REQUIRED", "A valid administrator Telegram ID is required");
  const allowedAdmins = String(process.env.COMMERCE_ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!allowedAdmins.includes(reviewer)) throw fail("ADMIN_NOT_AUTHORIZED", "Administrator ID is not allow-listed for manual bank reconciliation");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{4,127}$/.test(reference)) {
    throw fail("BANK_REFERENCE_INVALID", "A bank transaction reference of 5–128 safe characters is required");
  }
  // Compare references case-insensitively to prevent duplicate reconciliation when
  // a bank statement and operator type the same identifier with different casing.
  const referenceKey = reference.toUpperCase();
  const existingRef = readOrders().find((o) =>
    o.id !== String(orderId) &&
    o.paymentProvider === "manual_bank_reconciliation" &&
    String(o.paymentReference || "").trim().toUpperCase() === referenceKey
  );
  if (existingRef) throw fail("PAYMENT_REFERENCE_REPLAY", "This bank reference has already been used for another order");

  const paidOrder = updateOrder(orderId, (o) => {
    if (o.paymentStatus === "PAID") throw fail("ALREADY_PAID", "Order is already paid");
    if (["CANCELLED", "DELIVERED", "REFUNDED"].includes(o.status)) {
      throw fail("ORDER_NOT_REVIEWABLE", "Closed orders cannot be reconciled as paid");
    }
    if (o.status !== "PAYMENT_REVIEW" || !Array.isArray(o.paymentReceipts) || o.paymentReceipts.length === 0) {
      throw fail("PAYMENT_REVIEW_REQUIRED", "A customer receipt must be submitted before manual bank reconciliation");
    }
    const existingOrderReference = String(o.paymentReference || "");
    if (existingOrderReference && existingOrderReference !== reference) {
      throw fail("PAYMENT_REFERENCE_CONFLICT", "Order already has a different payment reference");
    }
    const now = new Date().toISOString();
    return {
      ...o,
      paymentStatus: "PAID",
      status: o.fulfillment === "delivery" ? "PAID" : "READY_FOR_PICKUP",
      paymentProvider: "manual_bank_reconciliation",
      paymentReference: reference,
      paymentVerification: {
        method: "manual_bank_reconciliation",
        bankReference: reference,
        verifiedByAdminId: reviewer,
        verifiedAt: now,
        amountKzt: o.totalKzt,
        currency: o.currency,
        receiptFileIds: (Array.isArray(o.paymentReceipts) ? o.paymentReceipts : []).map((r) => r.telegramFileId),
        attestation: "Administrator confirmed actual settled funds in the bank/payment-provider ledger; receipt image alone is not proof"
      },
      paymentAudit: [
        ...(Array.isArray(o.paymentAudit) ? o.paymentAudit : []),
        {
          event: "MANUAL_BANK_PAYMENT_CONFIRMED",
          adminId: reviewer,
          bankReference: reference,
          amountKzt: o.totalKzt,
          currency: o.currency,
          at: now
        }
      ]
    };
  });
  enqueuePaymentNotification(paidOrder.id);
  return paidOrder;
}
function reconcileManualBankPayment(orderId, adminId, bankReference) {
  return withTransaction(() => reconcileManualBankPaymentInternal(orderId, adminId, bankReference));
}

function markPaymentReceiptAdminNotified(orderId, telegramFileId, adminId) {
  const fileId = String(telegramFileId || "").trim();
  const recipientId = String(adminId || "").trim();
  if (!fileId || !recipientId) throw fail("NOTIFICATION_RECIPIENT_REQUIRED", "Receipt and administrator IDs are required");
  return updateOrder(orderId, (o) => ({
    ...o,
    paymentReceipts: (Array.isArray(o.paymentReceipts) ? o.paymentReceipts : []).map((receipt) =>
      receipt.telegramFileId === fileId
        ? { ...receipt, adminSentIds: [...new Set([...(Array.isArray(receipt.adminSentIds) ? receipt.adminSentIds : []), recipientId])] }
        : receipt
    )
  }));
}

function listPaymentReviewOrders() {
  return readOrders()
    .filter((o) => o.status === "PAYMENT_REVIEW" && o.paymentStatus !== "PAID")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function markDuplicatePaymentIncidentNotified(orderId, sessionId, adminId) {
  const sid = String(sessionId || "").trim();
  const aid = String(adminId || "").trim();
  if (!sid || !aid) throw fail("NOTIFICATION_RECIPIENT_REQUIRED", "Session and administrator IDs are required");
  return updateOrder(orderId, (o) => ({
    ...o,
    duplicatePaymentIncidents: (Array.isArray(o.duplicatePaymentIncidents) ? o.duplicatePaymentIncidents : []).map((incident) =>
      incident.sessionId === sid
        ? { ...incident, adminNotifiedIds: [...new Set([...(Array.isArray(incident.adminNotifiedIds) ? incident.adminNotifiedIds : []), aid])] }
        : incident
    )
  }));
}
function markNotification(orderId, kind, recipientId) {
  const allowed = new Set(["customer", "courier", "admin", "deliveryEscalated"]);
  if (!allowed.has(kind)) throw fail("INVALID_NOTIFICATION_KIND", "Invalid order notification kind");
  return updateOrder(orderId, (o) => {
    const current = o.notifications || { customerSentAt: null, courierSentIds: [], adminSentIds: [], deliveryEscalatedAt: null };
    const notifications = {
      customerSentAt: current.customerSentAt || null,
      courierSentIds: Array.isArray(current.courierSentIds) ? [...current.courierSentIds] : [],
      adminSentIds: Array.isArray(current.adminSentIds) ? [...current.adminSentIds] : [],
      deliveryEscalatedAt: current.deliveryEscalatedAt || null
    };
    const now = new Date().toISOString();
    if (kind === "customer") notifications.customerSentAt = notifications.customerSentAt || now;
    if (kind === "courier") {
      const id = String(recipientId || "").trim();
      if (!id) throw fail("NOTIFICATION_RECIPIENT_REQUIRED", "Courier ID is required");
      if (!notifications.courierSentIds.includes(id)) notifications.courierSentIds.push(id);
    }
    if (kind === "admin") {
      const id = String(recipientId || "").trim();
      if (!id) throw fail("NOTIFICATION_RECIPIENT_REQUIRED", "Admin ID is required");
      if (!notifications.adminSentIds.includes(id)) notifications.adminSentIds.push(id);
    }
    if (kind === "deliveryEscalated") notifications.deliveryEscalatedAt = notifications.deliveryEscalatedAt || now;
    return { ...o, notifications };
  });
}
function listPaidOrders() {
  return readOrders().filter((o) => o.paymentStatus === "PAID").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function updateOrderForTests(orderId, patch) {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw fail("TEST_HELPER_DISABLED", "Test-only order mutation is disabled in production");
  }
  return updateOrder(orderId, (order) => ({ ...order, ...patch }));
}
function resetForTests() {
  resetStorageForTests();
}
module.exports = {
  getCatalog, getDeliveryZones, getOrder, listOrders, createOrder, createCheckoutSession,
  attachCheckoutSession, applyVerifiedPayment, assignCourier, markInDelivery, attachProof,
  markPhotoDelivered, markDelivered, submitPaymentReceipt, markPaymentReceiptAdminNotified,
  listPaymentReviewOrders, reconcileManualBankPayment, markNotification,
  markDuplicatePaymentIncidentNotified, listPaidOrders, resetForTests, updateOrderForTests,
  claimPendingOutboxJobs, completeOutboxJob, retryOutboxJob, listOutboxJobsForTests
};
