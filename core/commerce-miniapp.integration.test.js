"use strict";

// Integration seam test: real Commerce domain + in-memory SQLite; only Stripe's
// outbound HTTP response is stubbed. This is not a signed-webhook/deployed E2E test.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("Mini App order → stored Stripe TEST session → idempotent webhook replay", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-miniapp-it-"));
  const script = String.raw`
    const assert = require("node:assert/strict");
    const commerce = require("./commerce");
    const stripe = require("./commerce-stripe");
    const { createMiniAppCommerceHandlers } = require("./commerce-miniapp");

    function response() {
      return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
      };
    }
    function req(userId, body = {}, key = "") {
      return {
        requestId: "integration-test",
        telegramWebApp: { user: { id: userId } },
        body, params: {},
        get(name) { return name.toLowerCase() === "idempotency-key" ? key : undefined; }
      };
    }

    global.fetch = async (url, options = {}) => {
      assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
      assert.equal(options.method, "POST");
      assert.match(options.headers.Authorization, /^Bearer sk_test_/);
      const form = new URLSearchParams(options.body);
      const orderId = form.get("client_reference_id");
      const amount = Number(form.get("line_items[0][price_data][unit_amount]"));
      assert.ok(orderId && amount > 0);
      const payload = {
        id: "cs_test_integration123",
        object: "checkout.session",
        livemode: false,
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        client_reference_id: orderId,
        metadata: { order_id: orderId },
        currency: "kzt",
        amount_total: amount,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        url: "https://checkout.stripe.com/c/pay/cs_test_integration123"
      };
      return { ok: true, json: async () => payload };
    };

    (async () => {
      const handlers = createMiniAppCommerceHandlers({ commerce, enabled: () => true });
      const body = {
        productId: "tea",
        quantity: 2,
        fulfillment: "pickup",
        customerId: "client-supplied-forbidden-value",
        totalKzt: 1
      };

      const first = response();
      handlers.createOrder(req(42001, body, "it-order-key-0001"), first);
      assert.equal(first.statusCode, 201, JSON.stringify(first.body));
      const orderId = first.body.order.id;
      assert.match(orderId, /^SAM-[A-F0-9]{12}$/);
      assert.equal(first.body.order.totalKzt, 2400);
      assert.equal("customerId" in first.body.order, false);

      const retry = response();
      handlers.createOrder(req(42001, body, "it-order-key-0001"), retry);
      assert.equal(retry.statusCode, 201, JSON.stringify(retry.body));
      assert.equal(retry.body.order.id, orderId);
      assert.equal(commerce.listOrders({ customerId: "42001" }).length, 1);
      assert.equal(commerce.getOrder(orderId).customerId, "42001");

      const checkout = response();
      await handlers.checkout({ ...req(42001), params: { id: orderId } }, checkout);
      assert.equal(checkout.statusCode, 200, JSON.stringify(checkout.body));
      assert.equal(checkout.body.mode, "stripe_test");
      assert.equal(checkout.body.session.livemode, false);
      assert.equal(checkout.body.session.id, "cs_test_integration123");

      const stored = commerce.getOrder(orderId);
      assert.equal(stored.checkoutSessionId, "cs_test_integration123");
      assert.ok(stored.checkoutSessionIds.includes("cs_test_integration123"));
      const attempt = commerce.getPaymentAttemptBySession("stripe", "test", "cs_test_integration123");
      assert.equal(attempt.status, "OPEN");
      assert.equal(attempt.orderId, orderId);

      const event = {
        id: "evt_test_minapp_integration_001",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: {
          id: "cs_test_integration123",
          livemode: false,
          mode: "payment",
          payment_status: "paid",
          status: "complete",
          client_reference_id: orderId,
          metadata: { order_id: orderId },
          amount_total: attempt.expectedAmountMinor,
          currency: "kzt"
        } }
      };
      const applied = stripe.processStripeEvent(event);
      assert.equal(applied.pending, false);
      assert.equal(commerce.getOrder(orderId).paymentStatus, "PAID");

      const replay = stripe.processStripeEvent(event);
      assert.equal(replay.duplicate, true);
      assert.equal(commerce.getOrder(orderId).paymentStatus, "PAID");
      assert.equal(commerce.listOrders({ customerId: "42001" }).length, 1);
      process.stdout.write(JSON.stringify({
        orderId,
        totalKzt: stored.totalKzt,
        checkoutSessionStored: true,
        firstWebhookPaid: true,
        duplicateWebhookSafe: replay.duplicate === true
      }));
    })().catch((error) => {
      console.error(error && error.stack || error);
      process.exitCode = 1;
    });
  `;
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    COMMERCE_DB_PATH: ":memory:",
    COMMERCE_CURRENCY: "KZT",
    COMMERCE_PRODUCTS_JSON: JSON.stringify([{ id: "tea", name: "Tea", priceKzt: 1200, active: true }]),
    COMMERCE_DELIVERY_ZONES_JSON: "{}",
    STRIPE_SECRET_KEY: "sk_test_samurai_integration_stub",
    COMMERCE_SUCCESS_URL: "https://example.com/success",
    COMMERCE_CANCEL_URL: "https://example.com/cancel",
    NODE_ENV: "test"
  };
  try {
    const run = spawnSync(process.execPath, ["-e", script], {
      cwd: __dirname,
      env,
      encoding: "utf8",
      timeout: 15000
    });
    assert.equal(run.error, undefined, run.error && run.error.message);
    assert.equal(run.status, 0, run.stderr || run.stdout || "integration subprocess failed");
    const result = JSON.parse(run.stdout);
    assert.equal(result.totalKzt, 2400);
    assert.equal(result.checkoutSessionStored, true);
    assert.equal(result.firstWebhookPaid, true);
    assert.equal(result.duplicateWebhookSafe, true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
