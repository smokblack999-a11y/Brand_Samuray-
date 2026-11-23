"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  try { await run("http://127.0.0.1:" + address.port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-payment-http-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  delete require.cache[require.resolve("../payments/ledger")];
  const { createPaymentLedger } = require("../payments/ledger");
  const { createPaymentRouter } = require("../payments/http-router");
  const ledger = createPaymentLedger();
  const calls = { checkout: [], webhook: [] };
  const provider = {
    name: "stripe_test",
    async createOneTimeCheckout(input) {
      calls.checkout.push(input);
      return { sessionId: "cs_http_123", checkoutUrl: "https://checkout.stripe.com/test", mode: "test" };
    }
  };
  const runtime = {
    registry: { getProvider: () => provider },
    health: () => ({ enabled: true, mode: "test", provider: "stripe_test" })
  };
  const webhookProcessor = { async process(rawBody, headers) {
    calls.webhook.push({ rawBody, headers });
    if (headers["stripe-signature"] !== "sig_valid") throw Object.assign(new Error("bad signature"), { code: "STRIPE_WEBHOOK_SIGNATURE_INVALID" });
    return { received: true, duplicate: false, eventId: "evt_http_123" };
  } };
  const app = express();
  app.use(express.json({ verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); } }));
  app.use("/api/payments", createPaymentRouter({
    express, runtime, ledger, webhookProcessor,
    requireApiKey(req, res, next) {
      if (req.get("X-API-Key") !== "internal-test-key") return res.status(401).json({ ok: false });
      next();
    },
    resolveDeliveryOrder: async orderId => ({
      orderId, payable: true, customerId: "customer_123", productName: "Delivery",
      amountMinor: 250000, currency: "KZT", version: 3
    }),
    successUrl: "https://samurai.example/payment/success",
    cancelUrl: "https://samurai.example/payment/cancel"
  }));
  return { app, dir, ledger, calls };
}

test("delivery checkout uses server-side order data and records the provider session", async () => {
  const ctx = setup();
  try {
    await withServer(ctx.app, async base => {
      const response = await fetch(base + "/api/payments/delivery/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "internal-test-key" },
        body: JSON.stringify({ orderId: "order_123", amountMinor: 1, currency: "USD", customerId: "attacker" })
      });
      const body = await response.json();
      assert.equal(response.status, 201);
      assert.equal(body.payment.checkoutUrl, "https://checkout.stripe.com/test");
      assert.equal(ctx.calls.checkout[0].amountMinor, 250000);
      assert.equal(ctx.calls.checkout[0].currency, "KZT");
      assert.equal(ctx.calls.checkout[0].customerId, "customer_123");
      assert.equal(ctx.ledger.findPaymentBySession("cs_http_123").orderId, "order_123");
    });
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("delivery checkout requires internal API authentication", async () => {
  const ctx = setup();
  try {
    await withServer(ctx.app, async base => {
      const response = await fetch(base + "/api/payments/delivery/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: "order_123" })
      });
      assert.equal(response.status, 401);
      assert.equal(ctx.calls.checkout.length, 0);
    });
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("Stripe webhook route forwards exact raw body and rejects invalid signatures", async () => {
  const ctx = setup();
  try {
    await withServer(ctx.app, async base => {
      const payload = JSON.stringify({ id: "evt_http_123", type: "checkout.session.completed" });
      const bad = await fetch(base + "/api/payments/stripe/webhook", {
        method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "sig_bad" }, body: payload
      });
      assert.equal(bad.status, 400);
      const good = await fetch(base + "/api/payments/stripe/webhook", {
        method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "sig_valid" }, body: payload
      });
      assert.equal(good.status, 200);
      assert.equal(ctx.calls.webhook[0].rawBody.toString("utf8"), payload);
    });
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
