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
  const proof = commerce.attachProof(order.id, "777", { telegramFileId: "file-1", latitude: 43.2389, longitude: 76.8897 });
  assert.equal(proof.status, "PHOTO_RECEIVED");
  assert.equal(proof.proof.latitude, 43.2389);
  assert.equal(commerce.markDelivered(order.id, "777").status, "DELIVERED");
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

test("Stripe event only marks a matching test checkout as paid", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_stripe_123");
  const event = {
    id: "evt_paid_123", type: "checkout.session.completed",
    data: { object: {
      id: "cs_test_stripe_123", payment_status: "paid", amount_total: 570000,
      currency: "kzt", client_reference_id: order.id, metadata: { order_id: order.id }
    } }
  };
  const result = stripe.processStripeEvent(event);
  assert.equal(result.order.paymentStatus, "PAID");
  assert.equal(result.order.totalKzt, 5700);
  assert.equal(stripe.processStripeEvent({ ...event, id: "evt_pending", data: { object: { ...event.data.object, payment_status: "unpaid" } } }).pending, true);
});
