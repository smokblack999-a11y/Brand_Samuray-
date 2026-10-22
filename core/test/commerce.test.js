"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-commerce-"));
process.env.DATA_DIR = dataDir;
process.env.COMMERCE_CURRENCY = "KZT";
process.env.COMMERCE_PRODUCTS_JSON = JSON.stringify([{ id: "sample-1", name: "Тестовый товар", priceKzt: 5000 }]);
process.env.COMMERCE_DELIVERY_ZONES_JSON = JSON.stringify({ "Алматы-1": 700 });

const commerce = require("../commerce");
const stripe = require("../commerce-stripe");

function newDeliveryOrder() {
  return commerce.createOrder({
    customerId: "12345", productId: "sample-1", quantity: 1,
    fulfillment: "delivery", address: "Алматы, улица Тестовая, 1", deliveryZone: "Алматы-1"
  });
}

test("calculates product and delivery total from server-side price configuration", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  assert.equal(order.itemsTotalKzt, 5000);
  assert.equal(order.deliveryFeeKzt, 700);
  assert.equal(order.totalKzt, 5700);
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
});

test("order creation is idempotent for the same Telegram update", () => {
  commerce.resetForTests();
  const first = commerce.createOrder({ customerId: "12345", productId: "sample-1", quantity: 1, fulfillment: "pickup", idempotencyKey: "telegram:777" });
  const retry = commerce.createOrder({ customerId: "12345", productId: "sample-1", quantity: 1, fulfillment: "pickup", idempotencyKey: "telegram:777" });
  assert.equal(retry.id, first.id);
  assert.equal(commerce.listOrders().length, 1);
  assert.throws(() => commerce.createOrder({ customerId: "99999", productId: "sample-1", quantity: 1, fulfillment: "pickup", idempotencyKey: "telegram:777" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("rejects invalid delivery zone and quantity", () => {
  assert.throws(() => commerce.createOrder({
    customerId: "12345", productId: "sample-1", quantity: 1,
    fulfillment: "delivery", address: "Алматы, улица Тестовая, 1", deliveryZone: "UNKNOWN"
  }), { code: "DELIVERY_ZONE_NOT_FOUND" });
  assert.throws(() => commerce.createOrder({
    customerId: "12345", productId: "sample-1", quantity: 0, fulfillment: "pickup"
  }), { code: "INVALID_QUANTITY" });
});

test("courier assignment is blocked until a verified, exact payment is received", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  assert.throws(() => commerce.assignCourier(order.id, "777"), { code: "PAYMENT_NOT_CONFIRMED" });
  assert.throws(() => commerce.applyVerifiedPayment({
    verified: false, eventId: "evt-1", orderId: order.id, amountKzt: 5700, currency: "KZT"
  }), { code: "PAYMENT_NOT_VERIFIED" });
  commerce.attachCheckoutSession(order.id, "cs_test_order_1");
  assert.throws(() => commerce.applyVerifiedPayment({
    verified: true, eventId: "evt-2", orderId: order.id, sessionId: "cs_test_wrong",
    amountKzt: 5700, currency: "KZT"
  }), { code: "PAYMENT_SESSION_MISMATCH" });
  assert.throws(() => commerce.applyVerifiedPayment({
    verified: true, eventId: "evt-3", orderId: order.id, sessionId: "cs_test_order_1",
    amountKzt: 5701, currency: "KZT"
  }), { code: "PAYMENT_MISMATCH" });
  const paid = commerce.applyVerifiedPayment({
    verified: true, eventId: "evt-4", orderId: order.id, sessionId: "cs_test_order_1",
    amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  assert.equal(paid.order.paymentStatus, "PAID");
  assert.equal(paid.order.status, "PAID");
  assert.equal(commerce.assignCourier(order.id, "777").status, "COURIER_ASSIGNED");
  assert.equal(commerce.applyVerifiedPayment({
    verified: true, eventId: "evt-4", orderId: order.id, sessionId: "cs_test_order_1",
    amountKzt: 5700, currency: "KZT"
  }).duplicate, true);
  const secondOrder = newDeliveryOrder();
  commerce.attachCheckoutSession(secondOrder.id, "cs_test_order_2");
  assert.throws(() => commerce.applyVerifiedPayment({
    verified: true, eventId: "evt-4", orderId: secondOrder.id, sessionId: "cs_test_order_2",
    amountKzt: 5700, currency: "KZT"
  }), { code: "PAYMENT_EVENT_REPLAY_MISMATCH" });
});

test("photo proof must belong to the assigned courier and is required before delivery completion", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_order_2");
  commerce.applyVerifiedPayment({
    verified: true, eventId: "evt-5", orderId: order.id, sessionId: "cs_test_order_2",
    amountKzt: 5700, currency: "KZT"
  });
  commerce.assignCourier(order.id, "777");
  assert.throws(() => commerce.attachProof(order.id, "999", { telegramFileId: "file-1" }), { code: "FORBIDDEN" });
  assert.throws(() => commerce.markDelivered(order.id, "777"), { code: "PHOTO_REQUIRED" });
  const proof = commerce.attachProof(order.id, "777", { telegramFileId: "file-1", sha256: "a".repeat(64), latitude: 43.2389, longitude: 76.8897 });
  assert.equal(proof.status, "PHOTO_RECEIVED");
  assert.equal(proof.proof.latitude, 43.2389);
  assert.throws(() => commerce.markPhotoDelivered(order.id, "999", "file-1"), { code: "FORBIDDEN" });
  assert.throws(() => commerce.markPhotoDelivered(order.id, "777", "other-file"), { code: "PHOTO_PROOF_MISMATCH" });
  const customerSent = commerce.markPhotoDelivered(order.id, "777", "file-1");
  assert.ok(customerSent.proof.customerSentAt);
  assert.equal(commerce.markDelivered(order.id, "777").status, "DELIVERED");
});

test("expired Stripe checkout session is replaced on payment retry", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_expired", "https://checkout.stripe.test/expired");
  const file = path.join(dataDir, "commerce-orders.json");
  const orders = JSON.parse(fs.readFileSync(file, "utf8"));
  orders[0].checkoutSessionExpiresAt = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(file, JSON.stringify(orders, null, 2) + "\n");
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  let lastRequest;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    lastRequest = options;
    return { ok: true, json: async () => ({ id: "cs_test_replacement", url: "https://checkout.stripe.test/replacement", expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
  });
  const checkout = await commerce.createCheckoutSession(order.id);
  assert.equal(checkout.sessionId, "cs_test_replacement");
  assert.equal(checkout.order.checkoutSessionId, "cs_test_replacement");
  assert.ok(Date.parse(checkout.order.checkoutSessionExpiresAt) > Date.now());
  assert.equal(lastRequest.headers["Idempotency-Key"], checkout.order.checkoutAttemptKey);
  const submitted = new URLSearchParams(lastRequest.body);
  assert.equal(submitted.get("line_items[0][price_data][unit_amount]"), "570000");
  assert.deepEqual(checkout.order.checkoutSessionIds, ["cs_test_expired", "cs_test_replacement"]);
  const delayedWebhook = commerce.applyVerifiedPayment({
    verified: true, eventId: "evt_delayed_old_session", orderId: order.id,
    sessionId: "cs_test_expired", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  assert.equal(delayedWebhook.order.paymentStatus, "PAID");
});

test("Stripe checkout retries reuse the persisted idempotency key after a network failure", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  let calls = 0;
  const keys = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls += 1;
    keys.push(options.headers["Idempotency-Key"]);
    if (calls === 1) throw new Error("simulated network timeout");
    return { ok: true, json: async () => ({ id: "cs_test_after_retry", url: "https://checkout.stripe.test/retry", expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
  });
  await assert.rejects(commerce.createCheckoutSession(order.id));
  const afterFailure = commerce.getOrder(order.id);
  assert.ok(afterFailure.checkoutAttemptKey);
  const result = await commerce.createCheckoutSession(order.id);
  assert.equal(result.sessionId, "cs_test_after_retry");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("Stripe signature rejects tampering and accepts a current valid signature", () => {
  const raw = Buffer.from(JSON.stringify({ id: "evt_sig", type: "noop", data: { object: {} } }));
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = "whsec_test_secret";
  const signature = crypto.createHmac("sha256", secret).update(String(timestamp) + ".").update(raw).digest("hex");
  assert.equal(stripe.verifyStripeSignature(raw, "t=" + timestamp + ",v1=" + signature, secret), true);
  assert.equal(stripe.verifyStripeSignature(Buffer.from("tampered"), "t=" + timestamp + ",v1=" + signature, secret), false);
  assert.equal(stripe.verifyStripeSignature(raw, "t=" + (timestamp - 1000) + ",v1=" + signature, secret), false);
});

test("Stripe webhook rejects live mode, wrong Checkout mode and conflicting order references", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_guard_123");
  const validSession = {
    id: "cs_test_guard_123", livemode: false, mode: "payment", status: "complete",
    payment_status: "paid", amount_total: 570000, currency: "kzt",
    client_reference_id: order.id, metadata: { order_id: order.id }
  };
  const event = { id: "evt_guard_1", type: "checkout.session.completed", livemode: false, data: { object: validSession } };
  assert.throws(() => stripe.processStripeEvent({ ...event, livemode: true, id: "evt_guard_live" }), { code: "LIVE_PAYMENT_MODE_DISABLED" });
  assert.throws(() => stripe.processStripeEvent({ ...event, id: "evt_guard_session_live", data: { object: { ...validSession, livemode: true } } }), { code: "INVALID_CHECKOUT_MODE" });
  assert.throws(() => stripe.processStripeEvent({ ...event, id: "evt_guard_subscription", data: { object: { ...validSession, mode: "subscription" } } }), { code: "INVALID_CHECKOUT_MODE" });
  assert.throws(() => stripe.processStripeEvent({ ...event, id: "evt_guard_mismatch", data: { object: { ...validSession, client_reference_id: "SAM-OTHER" } } }), { code: "INVALID_CHECKOUT_SESSION" });
  assert.equal(commerce.getOrder(order.id).paymentStatus, "AWAITING_PAYMENT");
});

test("Stripe event only marks a matching test checkout as paid", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_stripe_123");
  const event = {
    id: "evt_paid_123", type: "checkout.session.completed", livemode: false,
    data: { object: {
      id: "cs_test_stripe_123", livemode: false, mode: "payment", status: "complete", payment_status: "paid", amount_total: 570000,
      currency: "kzt", client_reference_id: order.id, metadata: { order_id: order.id }
    } }
  };
  const result = stripe.processStripeEvent(event);
  assert.equal(result.order.paymentStatus, "PAID");
  assert.equal(result.order.totalKzt, 5700);
  assert.equal(stripe.processStripeEvent({ ...event, id: "evt_pending", data: { object: { ...event.data.object, payment_status: "unpaid", status: "complete" } } }).pending, true);
});
