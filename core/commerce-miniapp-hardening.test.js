"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMiniAppCommerceHandlers, registerCommerceMiniAppRoutes } = require("./commerce-miniapp");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function request(id = "SAM-OWNER") {
  return {
    requestId: "req-hardening",
    telegramWebApp: { user: { id: 42 } },
    params: { id },
    body: {},
    get() { return undefined; }
  };
}

function ownedOrder() {
  return {
    id: "SAM-OWNER",
    customerId: "42",
    productId: "tea",
    productName: "Tea",
    quantity: 1,
    fulfillment: "pickup",
    currency: "KZT",
    totalKzt: 1200,
    paymentStatus: "AWAITING_PAYMENT",
    status: "AWAITING_PAYMENT"
  };
}

test("order lookup maps storage exceptions to a bounded 503 response", () => {
  const handlers = createMiniAppCommerceHandlers({
    commerce: { getOrder() { throw new Error("private database path / disk detail"); } },
    enabled: () => true
  });
  const res = response();
  handlers.getOrder(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, "COMMERCE_STORAGE_UNAVAILABLE");
  assert.equal(res.body.error.message, "Order lookup is unavailable");
  assert.equal(JSON.stringify(res.body).includes("private database path"), false);
});

test("async checkout lookup maps storage exceptions to a bounded 503 response", async () => {
  const handlers = createMiniAppCommerceHandlers({
    commerce: { getOrder() { throw new Error("private database path / disk detail"); } },
    enabled: () => true
  });
  const res = response();
  await handlers.checkout(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, "COMMERCE_STORAGE_UNAVAILABLE");
  assert.equal(JSON.stringify(res.body).includes("private database path"), false);
});

test("checkout adapter refuses a non-Stripe or non-HTTPS URL", async () => {
  const handlers = createMiniAppCommerceHandlers({
    commerce: {
      getOrder() { return ownedOrder(); },
      async createCheckoutSession() {
        return {
          order: ownedOrder(),
          sessionId: "cs_test_abc123",
          url: "https://attacker.example/collect"
        };
      }
    },
    enabled: () => true
  });
  const res = response();
  await handlers.checkout(request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, "STRIPE_SESSION_INVALID");
  assert.equal(res.body.session, undefined);
});


test("test-only Mini App Commerce stays disabled in production even with explicit flags", () => {
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    COMMERCE_MINIAPP_ENABLED: process.env.COMMERCE_MINIAPP_ENABLED,
    COMMERCE_MODE: process.env.COMMERCE_MODE
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.COMMERCE_MINIAPP_ENABLED = "true";
    process.env.COMMERCE_MODE = "test";
    const handlers = createMiniAppCommerceHandlers({
      commerce: { getCatalog() { return []; } }
    });
    const res = response();
    let nextCalled = false;
    handlers.featureEnabled(request(), res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, "COMMERCE_MINIAPP_DISABLED");
    assert.equal(nextCalled, false);
  } finally {
    for (const key of Object.keys(env)) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  }
});


test("all Mini App Commerce routes register Telegram auth before the feature gate", () => {
  const routes = [];
  const requireAuth = function requireWebAppAuth() {};
  const app = {
    get(path, ...handlers) { routes.push({ method: "GET", path, handlers }); },
    post(path, ...handlers) { routes.push({ method: "POST", path, handlers }); }
  };
  registerCommerceMiniAppRoutes(app, { commerce: {}, requireWebAppAuth: requireAuth });
  assert.deepEqual(routes.map(route => route.method + " " + route.path), [
    "GET /v1/commerce/catalog",
    "POST /v1/commerce/orders",
    "GET /v1/commerce/orders/:id",
    "POST /v1/commerce/orders/:id/checkout"
  ]);
  for (const route of routes) {
    assert.equal(route.handlers[0], requireAuth, route.method + " " + route.path + " must require Telegram auth first");
    assert.equal(typeof route.handlers[1], "function", "feature gate must follow auth");
    assert.equal(typeof route.handlers[2], "function", "route handler must be present");
  }
});

test("checkout response returns the canonical validated Stripe URL", async () => {
  const handlers = createMiniAppCommerceHandlers({
    commerce: {
      getOrder() { return ownedOrder(); },
      async createCheckoutSession() {
        return {
          order: ownedOrder(),
          sessionId: "cs_test_abc123",
          url: "https://CHECKOUT.STRIPE.COM/c/pay/test"
        };
      }
    },
    enabled: () => true
  });
  const res = response();
  await handlers.checkout(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.session.url, "https://checkout.stripe.com/c/pay/test");
});

