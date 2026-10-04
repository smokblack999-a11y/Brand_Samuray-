"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  verifySignature,
  normalizeStripeEvent,
  amountToKZT
} = require("./stripe-webhook");

function signed(rawBody, secret, timestamp) {
  const payload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

test("Stripe signature verification accepts an authentic fresh payload", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_test" });
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal(verifySignature(body, signed(body, secret, timestamp), secret), true);
});

test("Stripe signature verification rejects stale and invalid payloads", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_test" });
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal(verifySignature(body, "t=" + timestamp + ",v1=deadbeef", secret), false);
  assert.equal(verifySignature(body, signed(body, secret, timestamp - 10000), secret, 300, timestamp), false);
});

test("Stripe Checkout paid event becomes a WON revenue outcome", () => {
  const event = {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    created: 1790000000,
    data: {
      object: {
        id: "cs_123",
        payment_status: "paid",
        amount_total: 1250000,
        currency: "KZT",
        customer: "cus_123",
        metadata: {
          tenant_id: "tenant-a",
          decision_id: "dec-1",
          correlation_id: "corr-1",
          gross_margin_rate: "0.3"
        }
      }
    }
  };
  const result = normalizeStripeEvent(event);
  assert.equal(result.ignored, false);
  assert.equal(result.status, "WON");
  assert.equal(result.revenueKZT, 12500);
  assert.equal(result.tenantId, "tenant-a");
  assert.equal(result.actionId, "dec-1");
});

test("Stripe unpaid Checkout completion is ignored", () => {
  const event = {
    id: "evt_checkout_2",
    type: "checkout.session.completed",
    data: { object: { id: "cs_456", payment_status: "unpaid", amount_total: 10000, currency: "KZT" } }
  };
  const result = normalizeStripeEvent(event);
  assert.equal(result.ignored, true);
  assert.equal(result.reason, "CHECKOUT_NOT_PAID");
});

test("Stripe refund event creates a reversal outcome", () => {
  const event = {
    id: "evt_refund_1",
    type: "refund.created",
    created: 1790000000,
    data: {
      object: {
        id: "re_123",
        amount: 250000,
        currency: "KZT",
        metadata: { tenant_id: "tenant-a" }
      }
    }
  };
  const result = normalizeStripeEvent(event);
  assert.equal(result.status, "REFUNDED");
  assert.equal(result.revenueKZT, 2500);
});

test("Non-KZT Stripe currency requires an explicit FX rate", () => {
  const old = process.env.STRIPE_USD_KZT_RATE;
  delete process.env.STRIPE_USD_KZT_RATE;
  assert.equal(amountToKZT(1000, "USD"), null);
  process.env.STRIPE_USD_KZT_RATE = "500";
  assert.equal(amountToKZT(1000, "USD"), 5000);
  if (old == null) delete process.env.STRIPE_USD_KZT_RATE;
  else process.env.STRIPE_USD_KZT_RATE = old;
});
