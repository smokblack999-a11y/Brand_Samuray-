"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CommerceStore } = require("../commerce");
const { customerIdFromVerifiedTelegram, registerCommerceRoutes } = require("../commerce-http");
const { createStripeTestClient, stripeAmountMinor, registerStripeTestWebhook } = require("../stripe-test");

const catalog = { mode: "test", products: [
  { sku: "demo-digital-guide", name: "Demo guide", description: "Demo", type: "digital", priceMinor: 1990, currency: "KZT", stock: 4, active: true, deliveryText: "DEMO ONLY" },
  { sku: "demo-physical-box", name: "Demo box", description: "Demo", type: "physical", priceMinor: 4990, currency: "KZT", stock: 2, active: true, physicalInstructions: "DEMO ONLY" }
] };
async function withStore(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-commerce-test-"));
  const catalogFile = path.join(root, "catalog.json");
  const dataDir = path.join(root, "state");
  await fs.writeFile(catalogFile, JSON.stringify(catalog), "utf8");
  try {
    const store = await new CommerceStore({ dataDir, catalogFile, mode: "test" }).init();
    return await fn({ store, root, dataDir, catalogFile });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
function stripeEnv(extra = {}) {
  return { NODE_ENV: "test", COMMERCE_ENABLED: "true", COMMERCE_MODE: "test", STRIPE_TEST_MODE: "true",
    STRIPE_SECRET_KEY: "sk_test_example123", STRIPE_WEBHOOK_SECRET: "whsec_example123",
    STRIPE_SUCCESS_URL: "https://example.test/success", STRIPE_CANCEL_URL: "https://example.test/cancel", ...extra };
}
function checkoutSession(id = "cs_test_example123") {
  return { id, url: "https://checkout.stripe.com/c/pay/" + id, livemode: false, expires_at: Math.floor(Date.now() / 1000) + 1800 };
}

test("Commerce rejects live mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-commerce-live-"));
  try { await assert.rejects(new CommerceStore({ dataDir: root, mode: "live" }).init(), e => e.code === "REAL_PAYMENTS_NOT_IMPLEMENTED"); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("order total is server-calculated and stock is reserved", async () => withStore(async ({ store }) => {
  const order = await store.createOrder({ sku: "demo-digital-guide", quantity: 2, customerId: "tg:12345" });
  assert.equal(order.totalMinor, 3980);
  assert.equal(order.unitPriceMinor, 1990);
  assert.equal(store.listProducts().find(p => p.sku === order.sku).stock, 2);
  assert.equal(store.listProducts().find(p => p.sku === order.sku).deliveryText, undefined);
}));

test("parallel orders cannot oversell within one process", async () => withStore(async ({ store }) => {
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => store.createOrder({ sku: "demo-physical-box", quantity: 1, customerId: "tg:2" })));
  assert.equal(attempts.filter(x => x.status === "fulfilled").length, 2);
  assert.equal(attempts.filter(x => x.status === "rejected" && x.reason.code === "INSUFFICIENT_STOCK").length, 3);
}));

test("order access is scoped to the verified customer id", async () => withStore(async ({ store }) => {
  const order = await store.createOrder({ sku: "demo-digital-guide", quantity: 1, customerId: "tg:12345" });
  assert.equal(store.getOrder(order.id, "tg:99999"), null);
  assert.equal(store.getOrder(order.id, "tg:12345").id, order.id);
}));

test("manual cancel and simulated payment cannot race an active Stripe checkout", async () => withStore(async ({ store }) => {
  const order = await store.createOrder({ sku: "demo-digital-guide", quantity: 1, customerId: "tg:14" });
  await store.recordStripeCheckout(order.id, "tg:14", checkoutSession());
  await assert.rejects(store.cancelOrder(order.id, "tg:14"), e => e.code === "STRIPE_CHECKOUT_ACTIVE");
  await assert.rejects(store.simulatePayment(order.id, "tg:14"), e => e.code === "STRIPE_CHECKOUT_ACTIVE");
  assert.equal(store.listProducts().find(p => p.sku === order.sku).stock, 3);
}));
test("test payment is idempotent and physical orders do not claim shipment", async () => withStore(async ({ store }) => {
  const digital = await store.createOrder({ sku: "demo-digital-guide", quantity: 1, customerId: "tg:11" });
  const first = await store.simulatePayment(digital.id, "tg:11");
  const second = await store.simulatePayment(digital.id, "tg:11");
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "fulfilled");
  assert.equal(second.fulfillment.kind, "demo_digital");
  const physical = await store.createOrder({ sku: "demo-physical-box", quantity: 1, customerId: "tg:12" });
  const physicalPaid = await store.simulatePayment(physical.id, "tg:12");
  assert.equal(physicalPaid.status, "test_paid");
  assert.equal(physicalPaid.fulfillment.kind, "demo_physical_request");
}));

test("cancelling an unpaid order restores stock only once", async () => withStore(async ({ store }) => {
  const order = await store.createOrder({ sku: "demo-physical-box", quantity: 1, customerId: "tg:13" });
  await store.cancelOrder(order.id, "tg:13");
  await store.cancelOrder(order.id, "tg:13");
  assert.equal(store.listProducts().find(p => p.sku === order.sku).stock, 2);
}));

test("Telegram customer identity is derived from verified WebApp data only", () => {
  assert.equal(customerIdFromVerifiedTelegram({ telegramWebApp: { user: { id: 987654 } } }), "tg:987654");
  assert.equal(customerIdFromVerifiedTelegram({ body: { customerId: "tg:987654" } }), null);
  assert.equal(customerIdFromVerifiedTelegram({ telegramWebApp: { user: { id: -1 } } }), null);
});

test("Stripe client is locked unless test-mode flags and test credentials are present", () => {
  assert.equal(createStripeTestClient({ env: {} }).isConfigured(), false);
  assert.equal(createStripeTestClient({ env: stripeEnv({ NODE_ENV: "production" }) }).isConfigured(), false);
  assert.equal(createStripeTestClient({ env: stripeEnv({ STRIPE_SECRET_KEY: "sk_live_example" }) }).isConfigured(), false);
  assert.equal(createStripeTestClient({ env: stripeEnv() }).isConfigured(), true);
});

test("Stripe Checkout validates the response and uses per-order idempotency", async () => {
  let request;
  const client = createStripeTestClient({ env: stripeEnv(), fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ...checkoutSession(), livemode: false }) };
  } });
  const order = { id: "ord_0123456789abcdef01234567", customerId: "tg:456", currency: "KZT", quantity: 1, unitPriceMinor: 1990, totalMinor: 1990, productType: "digital", productName: "Demo guide" };
  const session = await client.createCheckoutSession(order);
  assert.equal(session.livemode, false);
  assert.equal(request.options.headers.Authorization, "Bearer sk_test_example123");
  assert.equal(request.options.headers["Idempotency-Key"], "samurai-order-" + order.id);
  assert.equal(new URLSearchParams(request.options.body).get("line_items[0][price_data][unit_amount]"), "199000");
  assert.throws(() => stripeAmountMinor({ currency: "KZT", totalMinor: Number.MAX_SAFE_INTEGER }), e => e.code === "STRIPE_AMOUNT_INVALID");
});

test("Stripe webhook signature is checked over exact raw body and freshness window", () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const env = stripeEnv();
  const client = createStripeTestClient({ env });
  const raw = Buffer.from(JSON.stringify({ id: "evt_example123", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_example123" } } }));
  const signature = crypto.createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(String(timestamp) + ".").update(raw).digest("hex");
  const event = client.verifyAndParseWebhook(raw, "t=" + timestamp + ",v1=" + signature);
  assert.equal(event.id, "evt_example123");
  assert.throws(() => client.verifyAndParseWebhook(Buffer.from(raw.toString() + " "), "t=" + timestamp + ",v1=" + signature), e => e.code === "STRIPE_SIGNATURE_INVALID");
  assert.throws(() => client.verifyAndParseWebhook(raw, "t=" + (timestamp - 3600) + ",v1=" + signature), e => e.code === "STRIPE_SIGNATURE_INVALID");
});

test("Stripe webhook and Commerce routes are unique and versioned", () => {
  const routes = [];
  const app = { get: (p, ...h) => routes.push({ method: "GET", path: p, handlers: h }), post: (p, ...h) => routes.push({ method: "POST", path: p, handlers: h }) };
  const env = stripeEnv({ COMMERCE_TEST_PAYMENTS_ENABLED: "false" });
  const noopAuth = (_req, _res, next) => next();
  const stripe = createStripeTestClient({ env });
  registerCommerceRoutes(app, { storeProvider: async () => ({}), requireWebAppAuth: noopAuth, env, stripeClient: stripe });
  registerStripeTestWebhook(app, { storeProvider: async () => ({}), stripeClient: stripe, rawBodyMiddleware: (_req, _res, next) => next(), env });
  const paths = routes.map(r => r.method + " " + r.path);
  for (const required of ["GET /v1/commerce/catalog", "POST /v1/commerce/orders", "GET /v1/commerce/orders/:id", "POST /v1/commerce/orders/:id/checkout", "POST /v1/commerce/orders/:id/simulate-payment", "POST /webhooks/stripe"]) assert.ok(paths.includes(required), "missing " + required);
  assert.equal(paths.filter(p => p === "POST /webhooks/stripe").length, 1);
});

test("Commerce feature gate hides routes outside explicit test mode", () => {
  const routes = [];
  const app = { get: (p, ...h) => routes.push({ method: "GET", path: p, handlers: h }), post: (p, ...h) => routes.push({ method: "POST", path: p, handlers: h }) };
  const env = { NODE_ENV: "development", COMMERCE_ENABLED: "true", COMMERCE_MODE: "live" };
  registerCommerceRoutes(app, { storeProvider: async () => ({}), requireWebAppAuth: (_req, _res, next) => next(), env });
  const route = routes.find(r => r.path === "/v1/commerce/catalog");
  let status = 200; let body;
  route.handlers[0]({}, { status(n) { status = n; return this; }, json(value) { body = value; return this; } }, () => { throw new Error("gate should reject request"); });
  assert.equal(status, 404);
  assert.equal(body.error.code, "COMMERCE_TEST_ONLY");
});
