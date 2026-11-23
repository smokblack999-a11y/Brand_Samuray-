"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-payments-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  delete require.cache[require.resolve("../payments/ledger")];
  const { createPaymentLedger } = require("../payments/ledger");
  return { ledger: createPaymentLedger(), dir };
}

test("webhook event claims are idempotent and failed events can retry", () => {
  const { ledger, dir } = freshLedger();
  try {
    const first = ledger.claimEvent("evt_123", "checkout.session.completed", "cs_123");
    assert.equal(first.claimed, true);
    assert.equal(ledger.claimEvent("evt_123", "checkout.session.completed", "cs_123").claimed, false);
    ledger.markEvent("evt_123", "failed", "TEMP_FAILURE");
    const retry = ledger.claimEvent("evt_123", "checkout.session.completed", "cs_123");
    assert.equal(retry.claimed, true);
    assert.equal(retry.event.attempts, 2);
    ledger.markEvent("evt_123", "completed");
    assert.equal(ledger.claimEvent("evt_123", "checkout.session.completed", "cs_123").claimed, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("payment records persist and enforce terminal states", () => {
  const { ledger, dir } = freshLedger();
  try {
    const payment = ledger.createPayment({
      paymentId: "pay_123", orderId: "order_123", customerId: "customer_123",
      provider: "stripe_test", providerSessionId: "cs_123", amountMinor: 12500, currency: "KZT"
    });
    assert.equal(payment.status, "pending");
    ledger.setPaymentStatus("pay_123", "paid", "pi_123");
    assert.equal(ledger.getPayment("pay_123").paymentIntentId, "pi_123");
    assert.throws(() => ledger.setPaymentStatus("pay_123", "failed"),
      error => error.code === "PAYMENT_LEDGER_TRANSITION_INVALID");
    assert.throws(() => ledger.createPayment({
      paymentId: "pay_123", orderId: "order_123", customerId: "customer_123",
      provider: "stripe_test", providerSessionId: "cs_456", amountMinor: 12500, currency: "KZT"
    }), error => error.code === "PAYMENT_LEDGER_DUPLICATE");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("corrupt ledger fails closed instead of resetting payment history", () => {
  const { ledger, dir } = freshLedger();
  try {
    fs.writeFileSync(path.join(dir, "payments-ledger.json"), "not-json");
    assert.throws(() => ledger.listEvents(), error => error.code === "PAYMENT_LEDGER_CORRUPT");
    assert.equal(fs.readFileSync(path.join(dir, "payments-ledger.json"), "utf8"), "not-json");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
