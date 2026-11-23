"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-delivery-webhook-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  delete require.cache[require.resolve("../payments/ledger")];
  const { createPaymentLedger } = require("../payments/ledger");
  const { createDeliveryWebhookHandlers } = require("../payments/delivery-webhook-handlers");
  const ledger = createPaymentLedger();
  const payment = ledger.createPayment({
    paymentId: "pay_delivery_123", orderId: "order_123", customerId: "customer_123",
    provider: "stripe_test", providerSessionId: "cs_delivery_123", amountMinor: 250000, currency: "kzt"
  });
  const session = {
    id: "cs_delivery_123", mode: "payment", client_reference_id: "order_123",
    amount_total: 250000, currency: "kzt", payment_status: "paid",
    payment_intent: "pi_delivery_123",
    metadata: { samurai_flow: "delivery", samurai_order_id: "order_123", samurai_customer_id: "customer_123" }
  };
  return { dir, ledger, payment, session, create: options => createDeliveryWebhookHandlers({ ledger, ...options }) };
}

test("delivery handler verifies amount, currency, order, customer and payment status", async () => {
  const ctx = setup();
  try {
    let calls = 0;
    const handlers = ctx.create({ onPaid: async (payment) => { calls += 1; assert.equal(payment.status, "paid"); } });
    await handlers["checkout.session.completed"](ctx.session);
    assert.equal(ctx.ledger.getPayment(ctx.payment.paymentId).paymentIntentId, "pi_delivery_123");
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("delivery handler rejects amount, customer and order mismatches", async () => {
  const ctx = setup();
  try {
    const handlers = ctx.create({ onPaid: async () => {} });
    await assert.rejects(() => handlers["checkout.session.completed"]({ ...ctx.session, amount_total: 1 }),
      error => error.code === "PAYMENT_AMOUNT_MISMATCH");
    await assert.rejects(() => handlers["checkout.session.completed"]({
      ...ctx.session, metadata: { ...ctx.session.metadata, samurai_customer_id: "other" }
    }), error => error.code === "PAYMENT_ORDER_MISMATCH");
    await assert.rejects(() => handlers["checkout.session.completed"]({ ...ctx.session, payment_status: "unpaid" , amount_total: 2 }),
      error => error.code === "PAYMENT_AMOUNT_MISMATCH");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("completed but unpaid session is processing, not marked paid", async () => {
  const ctx = setup();
  try {
    const handlers = ctx.create({ onPaid: async () => { throw new Error("must not run"); } });
    await handlers["checkout.session.completed"]({ ...ctx.session, payment_status: "unpaid" });
    assert.equal(ctx.ledger.getPayment(ctx.payment.paymentId).status, "processing");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("paid handler is required to prevent silent fulfillment omission", () => {
  const ctx = setup();
  try {
    assert.throws(() => ctx.create({}), error => error.code === "PAYMENT_HANDLER_REQUIRED");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
