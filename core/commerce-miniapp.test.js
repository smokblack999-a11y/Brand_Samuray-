"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createMiniAppCommerceHandlers } = require("./commerce-miniapp");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function request({ userId = 42, body = {}, params = {}, headers = {} } = {}) {
  return {
    requestId: "req-test",
    telegramWebApp: { user: { id: userId } },
    body,
    params,
    get(name) { return headers[name] || headers[name.toLowerCase()] || undefined; }
  };
}

function fixture() {
  const orders = new Map();
  const calls = [];
  const commerce = {
    getCatalog() { return [{ id: "tea", name: "Tea", priceKzt: 1200, active: true }]; },
    getDeliveryZones() { return { central: 500 }; },
    createOrder(input) {
      calls.push(input);
      const order = {
        id: "SAM-0123456789AB", ...input, productId: input.productId,
        productName: "Tea", quantity: input.quantity, fulfillment: input.fulfillment,
        address: input.address || null, deliveryZone: input.deliveryZone || null,
        currency: "KZT", totalKzt: 1200 * input.quantity, paymentStatus: "AWAITING_PAYMENT",
        status: "AWAITING_PAYMENT", createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      };
      orders.set(order.id, order);
      return order;
    },
    getOrder(id) { return orders.get(id) || null; },
    async createCheckoutSession(id) {
      return { order: orders.get(id), sessionId: "cs_test_abc123", url: "https://checkout.stripe.com/c/pay/test" };
    }
  };
  return { commerce, orders, calls };
}

test("feature gate is closed when disabled", () => {
  const { commerce } = fixture();
  const handlers = createMiniAppCommerceHandlers({ commerce, enabled: () => false });
  const res = response();
  let nextCalled = false;
  handlers.featureEnabled(request(), res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, "COMMERCE_MINIAPP_DISABLED");
  assert.equal(nextCalled, false);
});

test("catalog only exposes the configured domain catalog", () => {
  const { commerce } = fixture();
  const handlers = createMiniAppCommerceHandlers({ commerce, enabled: () => true });
  const res = response();
  handlers.catalog(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.products[0].id, "tea");
  assert.equal(res.body.products[0].priceKzt, 1200);
  assert.equal(res.body.currency, "KZT");
});

test("order owner is derived from verified Telegram identity, not client customerId", () => {
  const { commerce, calls } = fixture();
  const handlers = createMiniAppCommerceHandlers({ commerce, enabled: () => true });
  const req = request({
    userId: 987654,
    body: { customerId: "attacker-controlled", productId: "tea", quantity: 2, fulfillment: "pickup" },
    headers: { "Idempotency-Key": "client-order-key-001" }
  });
  const res = response();
  handlers.createOrder(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customerId, "987654");
  assert.equal(calls[0].idempotencyKey, "miniapp:987654:client-order-key-001");
  assert.equal("customerId" in res.body.order, false);
});

test("foreign order IDs cannot be read", () => {
  const { commerce, orders } = fixture();
  orders.set("SAM-FOREIGN", {
    id: "SAM-FOREIGN", customerId: "100", productId: "tea", productName: "Tea",
    quantity: 1, fulfillment: "pickup", currency: "KZT", totalKzt: 1200,
    paymentStatus: "AWAITING_PAYMENT", status: "AWAITING_PAYMENT"
  });
  const handlers = createMiniAppCommerceHandlers({ commerce, enabled: () => true });
  const res = response();
  handlers.getOrder(request({ userId: 200, params: { id: "SAM-FOREIGN" } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, "ORDER_NOT_FOUND");
});

test("checkout is owner-scoped and only returns test-mode session metadata", async () => {
  const { commerce, orders } = fixture();
  orders.set("SAM-OWNER", {
    id: "SAM-OWNER", customerId: "42", productId: "tea", productName: "Tea",
    quantity: 1, fulfillment: "pickup", currency: "KZT", totalKzt: 1200,
    paymentStatus: "AWAITING_PAYMENT", status: "AWAITING_PAYMENT"
  });
  const handlers = createMiniAppCommerceHandlers({ commerce, enabled: () => true });
  const foreign = response();
  await handlers.checkout(request({ userId: 99, params: { id: "SAM-OWNER" } }), foreign);
  assert.equal(foreign.statusCode, 404);

  const own = response();
  await handlers.checkout(request({ userId: 42, params: { id: "SAM-OWNER" } }), own);
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.mode, "stripe_test");
  assert.equal(own.body.session.livemode, false);
  assert.equal(own.body.session.id, "cs_test_abc123");
  assert.equal("customerId" in own.body.order, false);
});


test("browser Mini App JavaScript parses under Node syntax checker", () => {
  const script = path.join(__dirname, "mini-app", "app.js");
  const checked = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout || "Mini App syntax check failed");
});
