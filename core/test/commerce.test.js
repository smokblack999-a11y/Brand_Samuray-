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
process.env.COMMERCE_ADMIN_IDS = "700";

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
  assert.throws(() => commerce.createOrder({ customerId: "12345", productId: "sample-1", quantity: 2, fulfillment: "pickup", idempotencyKey: "telegram:777" }), { code: "IDEMPOTENCY_CONFLICT" });
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

test("customer receipts enter PAYMENT_REVIEW but never mark the order paid", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  const submitted = commerce.submitPaymentReceipt(order.id, "12345", {
    telegramFileId: "telegram-receipt-photo-1",
    fileUniqueId: "telegram-receipt-unique-1"
  });
  assert.equal(submitted.status, "PAYMENT_REVIEW");
  assert.equal(submitted.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(submitted.paymentReceipts.length, 1);
  assert.equal(commerce.listPaymentReviewOrders().length, 1);
  assert.throws(() => commerce.submitPaymentReceipt(order.id, "99999", {
    telegramFileId: "receipt-other-user"
  }), { code: "FORBIDDEN" });
  const duplicate = commerce.submitPaymentReceipt(order.id, "12345", {
    telegramFileId: "telegram-receipt-photo-1",
    fileUniqueId: "telegram-receipt-unique-1"
  });
  assert.equal(duplicate.paymentReceipts.length, 1);
  assert.throws(() => commerce.assignCourier(order.id, "777"), { code: "PAYMENT_NOT_CONFIRMED" });
  commerce.markPaymentReceiptAdminNotified(order.id, "telegram-receipt-photo-1", "700");
  assert.deepEqual(commerce.getOrder(order.id).paymentReceipts[0].adminSentIds, ["700"]);

  commerce.attachCheckoutSession(order.id, "cs_test_receipt_paid");
  const paid = commerce.applyVerifiedPayment({
    verified: true, eventId: "evt_receipt_paid", orderId: order.id,
    sessionId: "cs_test_receipt_paid", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  assert.equal(paid.order.paymentStatus, "PAID");
  assert.equal(paid.order.status, "PAID");
  assert.equal(commerce.listPaymentReviewOrders().length, 0);
});

test("manual bank reconciliation requires review, stores audit data and blocks reference reuse", () => {
  process.env.COMMERCE_ADMIN_IDS = "700";
  commerce.resetForTests();
  const order = newDeliveryOrder();
  assert.throws(() => commerce.reconcileManualBankPayment(order.id, "700", "BANK-REF-001"), {
    code: "PAYMENT_REVIEW_REQUIRED"
  });

  commerce.submitPaymentReceipt(order.id, "12345", {
    telegramFileId: "bank-receipt-1",
    fileUniqueId: "bank-receipt-unique-1"
  });
  assert.throws(() => commerce.reconcileManualBankPayment(order.id, "admin", "BANK-REF-001"), {
    code: "ADMIN_ID_REQUIRED"
  });
  assert.throws(() => commerce.reconcileManualBankPayment(order.id, "700", "bad"), {
    code: "BANK_REFERENCE_INVALID"
  });
  assert.throws(() => commerce.reconcileManualBankPayment(order.id, "701", "BANK-REF-UNAUTH-001"), {
    code: "ADMIN_NOT_AUTHORIZED"
  });

  const confirmed = commerce.reconcileManualBankPayment(order.id, "700", "BANK-REF-2026-001");
  assert.equal(confirmed.paymentStatus, "PAID");
  assert.equal(confirmed.status, "PAID");
  assert.equal(confirmed.paymentProvider, "manual_bank_reconciliation");
  assert.equal(confirmed.paymentReference, "BANK-REF-2026-001");
  assert.equal(confirmed.paymentVerification.method, "manual_bank_reconciliation");
  assert.equal(confirmed.paymentVerification.verifiedByAdminId, "700");
  assert.ok(confirmed.paymentVerification.verifiedAt);
  assert.equal(confirmed.paymentVerification.amountKzt, 5700);
  assert.equal(confirmed.paymentVerification.currency, "KZT");
  assert.deepEqual(confirmed.paymentVerification.receiptFileIds, ["bank-receipt-1"]);
  assert.equal(confirmed.paymentAudit.at(-1).event, "MANUAL_BANK_PAYMENT_CONFIRMED");
  assert.equal(confirmed.paymentAudit.at(-1).amountKzt, 5700);
  assert.equal(confirmed.paymentAudit.at(-1).currency, "KZT");
  assert.equal(commerce.assignCourier(order.id, "777").status, "COURIER_ASSIGNED");

  const second = newDeliveryOrder();
  commerce.submitPaymentReceipt(second.id, "12345", {
    telegramFileId: "bank-receipt-2",
    fileUniqueId: "bank-receipt-unique-2"
  });
  assert.throws(() => commerce.reconcileManualBankPayment(second.id, "700", "bank-ref-2026-001"), {
    code: "PAYMENT_REFERENCE_REPLAY"
  });
  assert.equal(commerce.getOrder(second.id).paymentStatus, "AWAITING_PAYMENT");
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

test("closed orders cannot create a new Stripe Checkout session", async () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.updateOrderForTests(order.id, { status: "CANCELLED" });
  await assert.rejects(commerce.createCheckoutSession(order.id), { code: "ORDER_CLOSED" });
});

test("expired Stripe checkout session is replaced on payment retry", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_expired", "https://checkout.stripe.com/c/pay/expired");
  commerce.updateOrderForTests(order.id, { checkoutSessionExpiresAt: new Date(Date.now() - 60000).toISOString() });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  let lastRequest;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") {
      return {
        ok: true,
        json: async () => ({
          id: "cs_test_expired", livemode: false, mode: "payment", status: "expired",
          payment_status: "unpaid", client_reference_id: order.id, metadata: { order_id: order.id }
        })
      };
    }
    lastRequest = options;
    return { ok: true, json: async () => ({ id: "cs_test_replacement", url: "https://checkout.stripe.com/c/pay/replacement", livemode: false, mode: "payment", status: "open", client_reference_id: order.id, metadata: { order_id: order.id }, currency: "kzt", amount_total: 570000, expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
  });
  const checkout = await commerce.createCheckoutSession(order.id);
  assert.equal(checkout.sessionId, "cs_test_replacement");
  assert.equal(checkout.order.checkoutSessionId, "cs_test_replacement");
  assert.ok(Date.parse(checkout.order.checkoutSessionExpiresAt) > Date.now());
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, "GET");
  assert.match(requests[0].url, /cs_test_expired$/);
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

test("a paid but expired Checkout session is recovered from Stripe without creating a second link", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_already_paid", "https://checkout.stripe.com/c/pay/old");
  commerce.updateOrderForTests(order.id, { checkoutSessionExpiresAt: new Date(Date.now() - 60000).toISOString() });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        id: "cs_test_already_paid", livemode: false, mode: "payment", status: "complete",
        payment_status: "paid", amount_total: 570000, currency: "kzt",
        client_reference_id: order.id, metadata: { order_id: order.id }
      })
    };
  });
  const recovered = await commerce.createCheckoutSession(order.id);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(recovered.alreadyPaid, true);
  assert.equal(recovered.url, null);
  assert.equal(recovered.order.paymentStatus, "PAID");
  assert.equal(commerce.getOrder(order.id).paymentStatus, "PAID");
});

test("an expired Checkout with unresolved status does not produce another payable link", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_uncertain", "https://checkout.stripe.com/c/pay/old");
  commerce.updateOrderForTests(order.id, { checkoutSessionExpiresAt: new Date(Date.now() - 60000).toISOString() });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        id: "cs_test_uncertain", livemode: false, mode: "payment", status: "open",
        payment_status: "unpaid", client_reference_id: order.id, metadata: { order_id: order.id }
      })
    };
  });
  await assert.rejects(commerce.createCheckoutSession(order.id), { code: "PAYMENT_STATUS_PENDING" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(commerce.getOrder(order.id).checkoutSessionId, "cs_test_uncertain");
});

test("legacy Checkout session without stored expiry is reconciled before it can be reused", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_legacy_no_expiry", "https://checkout.stripe.com/c/pay/legacy");
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        id: "cs_test_legacy_no_expiry", livemode: false, mode: "payment",
        status: "open", payment_status: "unpaid",
        client_reference_id: order.id, metadata: { order_id: order.id }
      })
    };
  });
  await assert.rejects(commerce.createCheckoutSession(order.id), { code: "PAYMENT_STATUS_PENDING" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(commerce.getOrder(order.id).checkoutSessionId, "cs_test_legacy_no_expiry");
});

test("Checkout creation rejects a provider response with a mismatched amount before exposing the URL", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      id: "cs_test_wrong_amount", url: "https://checkout.stripe.com/c/pay/wrong",
      livemode: false, mode: "payment", status: "open",
      client_reference_id: order.id, metadata: { order_id: order.id },
      currency: "kzt", amount_total: 12345, expires_at: Math.floor(Date.now() / 1000) + 3600
    })
  }));
  await assert.rejects(commerce.createCheckoutSession(order.id), { code: "PAYMENT_SESSION_INVALID" });
  const after = commerce.getOrder(order.id);
  assert.equal(after.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(after.checkoutSessionId, undefined);
  assert.equal(after.checkoutUrl, undefined);
  assert.ok(after.checkoutAttemptKey);
});

test("Checkout creation refuses a non-Stripe hosted URL even with matching order details", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      id: "cs_test_wrong_host", url: "https://checkout.stripe.com.attacker.example/c/pay/fake",
      livemode: false, mode: "payment", status: "open",
      client_reference_id: order.id, metadata: { order_id: order.id },
      currency: "kzt", amount_total: 570000, expires_at: Math.floor(Date.now() / 1000) + 3600
    })
  }));
  await assert.rejects(commerce.createCheckoutSession(order.id), { code: "PAYMENT_SESSION_INVALID" });
  assert.equal(commerce.getOrder(order.id).checkoutUrl, undefined);
});

test("concurrent checkout requests use one Stripe idempotency key and converge on one session", async (t) => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
  process.env.COMMERCE_SUCCESS_URL = "https://example.test/success";
  process.env.COMMERCE_CANCEL_URL = "https://example.test/cancel";
  const requests = [];
  let signalBoth;
  let releaseRequests;
  const bothStarted = new Promise((resolve) => { signalBoth = resolve; });
  const blocked = new Promise((resolve) => { releaseRequests = resolve; });
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(options);
    if (requests.length === 2) signalBoth();
    await blocked;
    return {
      ok: true,
      json: async () => ({
        id: "cs_test_concurrent_one", url: "https://checkout.stripe.com/c/pay/concurrent",
        livemode: false, mode: "payment", status: "open",
        client_reference_id: order.id, metadata: { order_id: order.id },
        currency: "kzt", amount_total: 570000, expires_at: expiresAt
      })
    };
  });
  const first = commerce.createCheckoutSession(order.id);
  const second = commerce.createCheckoutSession(order.id);
  await bothStarted;
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  releaseRequests();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.sessionId, "cs_test_concurrent_one");
  assert.equal(b.sessionId, "cs_test_concurrent_one");
  assert.equal(commerce.getOrder(order.id).checkoutSessionIds.length, 1);
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
    return { ok: true, json: async () => ({ id: "cs_test_after_retry", url: "https://checkout.stripe.com/c/pay/retry", livemode: false, mode: "payment", status: "open", client_reference_id: order.id, metadata: { order_id: order.id }, currency: "kzt", amount_total: 570000, expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
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

test("late successful payment for a cancelled order is held for review and never reopens the order", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_late_closed");
  commerce.updateOrderForTests(order.id, { status: "CANCELLED" });

  const input = {
    verified: true, eventId: "evt_late_closed", orderId: order.id,
    sessionId: "cs_test_late_closed", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  };
  const result = commerce.applyVerifiedPayment(input);
  assert.equal(result.order.status, "CANCELLED");
  assert.equal(result.order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(result.duplicatePayment, true);
  assert.equal(result.incident.reason, "PAYMENT_AFTER_ORDER_CLOSED");
  assert.equal(result.incident.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.incident.adminNotifiedIds, []);

  const repeated = commerce.applyVerifiedPayment(input);
  assert.equal(repeated.order.status, "CANCELLED");
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.order.duplicatePaymentIncidents.length, 1);
});

test("verified payment and notification outbox are committed together and deduplicated", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_outbox_paid");
  const payment = {
    verified: true, eventId: "evt_outbox_paid", orderId: order.id,
    sessionId: "cs_test_outbox_paid", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  };
  const paid = commerce.applyVerifiedPayment(payment);
  assert.equal(paid.order.paymentStatus, "PAID");
  assert.equal(commerce.listOutboxJobsForTests().length, 1);
  assert.equal(commerce.listOutboxJobsForTests()[0].orderId, order.id);

  const duplicate = commerce.applyVerifiedPayment(payment);
  assert.equal(duplicate.duplicate, true);
  assert.equal(commerce.listOutboxJobsForTests().length, 1);
});

test("a second successful Checkout session is recorded as an admin reconciliation incident", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_first_paid");
  const first = commerce.applyVerifiedPayment({
    verified: true, eventId: "evt_first_paid", orderId: order.id,
    sessionId: "cs_test_first_paid", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  assert.equal(first.order.paymentStatus, "PAID");
  assert.equal(first.order.paymentSessionId, "cs_test_first_paid");

  commerce.attachCheckoutSession(order.id, "cs_test_second_paid");
  const second = commerce.applyVerifiedPayment({
    verified: true, eventId: "evt_second_paid", orderId: order.id,
    sessionId: "cs_test_second_paid", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.duplicatePayment, true);
  assert.equal(second.order.paymentStatus, "PAID");
  assert.equal(second.order.paymentSessionId, "cs_test_first_paid");
  assert.equal(second.order.duplicatePaymentIncidents.length, 1);
  assert.equal(second.order.duplicatePaymentIncidents[0].sessionId, "cs_test_second_paid");
  assert.equal(second.order.duplicatePaymentIncidents[0].status, "REVIEW_REQUIRED");
  assert.deepEqual(second.order.duplicatePaymentIncidents[0].adminNotifiedIds, []);
  commerce.markDuplicatePaymentIncidentNotified(order.id, "cs_test_second_paid", "700");
  assert.deepEqual(commerce.getOrder(order.id).duplicatePaymentIncidents[0].adminNotifiedIds, ["700"]);
});

test("a second Stripe event for the same successful session is idempotent, not a duplicate charge incident", () => {
  commerce.resetForTests();
  const order = newDeliveryOrder();
  commerce.attachCheckoutSession(order.id, "cs_test_single_paid");
  commerce.applyVerifiedPayment({
    verified: true, eventId: "evt_completed", orderId: order.id,
    sessionId: "cs_test_single_paid", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  const repeatedEvent = commerce.applyVerifiedPayment({
    verified: true, eventId: "evt_async_succeeded", orderId: order.id,
    sessionId: "cs_test_single_paid", amountKzt: 5700, currency: "KZT", provider: "stripe_test"
  });
  assert.equal(repeatedEvent.duplicate, true);
  assert.equal(repeatedEvent.duplicatePayment, undefined);
  assert.equal(repeatedEvent.order.duplicatePaymentIncidents.length, 0);
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
