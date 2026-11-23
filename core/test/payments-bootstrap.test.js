"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mountPaymentRoutes } = require("../payments/bootstrap");

function adapter() {
  return {
    requireCustomerIdentity(_req, _res, next) { next(); },
    async resolveDeliveryOrder() { return null; },
    async onDeliveryCheckoutPreparing() {},
    async onDeliveryCheckoutCreated() {},
    async onDeliveryCheckoutFailed() {},
    async onDeliveryPaid() {},
    async onDeliveryFailed() {}
  };
}

function provider() {
  return {
    name: "stripe_test",
    async createOneTimeCheckout() { return { sessionId: "cs_bootstrap", checkoutUrl: "https://checkout.stripe.com/test", mode: "test" }; },
    async createSubscriptionCheckout() { return { sessionId: "cs_saas_bootstrap", checkoutUrl: "https://checkout.stripe.com/test", mode: "test" }; },
    async verifyWebhook() { return {}; },
    async parseWebhook() { return { eventId: "evt_bootstrap", type: "ignored", object: {} }; },
    async retrieveSubscription(id) { return { id, customer: "cus_bootstrap", status: "active", metadata: { samurai_flow: "saas", samurai_customer_id: "customer_bootstrap", samurai_plan_id: "pro" } }; },
    async refund() {},
    async health() { return { ok: true, mode: "test" }; }
  };
}

test("payments HTTP integration is not mounted by default", () => {
  const app = express();
  const result = mountPaymentRoutes({ app, express, env: {} });
  assert.deepEqual(result, { mounted: false, reason: "payments_http_disabled" });
});

test("payments HTTP integration refuses to start without a real domain adapter", () => {
  const app = express();
  assert.throws(() => mountPaymentRoutes({
    app, express, env: { PAYMENTS_HTTP_ENABLED: "true" }
  }), error => error.code === "PAYMENT_DOMAIN_ADAPTER_REQUIRED");
});

test("payments HTTP integration refuses incomplete domain callbacks", () => {
  const app = express();
  assert.throws(() => mountPaymentRoutes({
    app, express, env: { PAYMENTS_HTTP_ENABLED: "true" }, domainAdapter: {}
  }), error => error.code === "PAYMENT_DOMAIN_ADAPTER_INCOMPLETE");
});

test("payments HTTP integration mounts only in explicitly enabled test mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-payment-bootstrap-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  try {
    delete require.cache[require.resolve("../payments/ledger")];
    const app = express();
    const stripe = provider();
    const result = mountPaymentRoutes({
      app,
      express,
      env: {
        PAYMENTS_HTTP_ENABLED: "true",
        PAYMENTS_ENABLED: "true",
        PAYMENTS_MODE: "test",
        PAYMENTS_PROVIDER: "stripe_test",
        PAYMENTS_SUCCESS_URL: "https://samurai.example/success",
        PAYMENTS_CANCEL_URL: "https://samurai.example/cancel"
      },
      domainAdapter: adapter(),
      requireApiKey(_req, _res, next) { next(); },
      runtimeFactory: () => ({
        registry: { getProvider: () => stripe },
        health: () => ({ enabled: true, mode: "test", provider: "stripe_test" })
      })
    });
    assert.deepEqual(result, { mounted: true, prefix: "/api/payments", mode: "test", provider: "stripe_test" });
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    try {
      const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/payments/status");
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.payments.provider, "stripe_test");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
