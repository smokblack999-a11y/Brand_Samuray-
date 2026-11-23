"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStripeTestProvider, API_VERSION } = require("../payments/stripe-test-provider");

function makeSdk() {
  const calls = { checkout: [], refunds: [], webhook: [], subscriptions: [] };
  class StripeClient {
    constructor(key, options) {
      calls.key = key;
      calls.options = options;
      this.checkout = { sessions: { create: async (params, opts) => {
        calls.checkout.push({ params, opts });
        return { id: "cs_test_123", url: "https://checkout.stripe.com/test" };
      } } };
      this.subscriptions = { retrieve: async id => { calls.subscriptions.push(id); return { id, customer: "cus_test_123", status: "active", metadata: { samurai_flow: "saas", samurai_customer_id: "customer_123", samurai_plan_id: "pro" } }; } };
      this.webhooks = { constructEvent: (body, signature, secret) => {
        calls.webhook.push({ body, signature, secret });
        return { id: "evt_test_123", type: "checkout.session.completed", data: { object: { payment_status: "paid" } } };
      } };
      this.refunds = { create: async (params, opts) => {
        calls.refunds.push({ params, opts });
        return { id: "re_test_123", status: "succeeded" };
      } };
    }
  }
  return { StripeClient, calls };
}

function setup(overrides = {}) {
  const sdk = makeSdk();
  const provider = createStripeTestProvider({
    StripeClient: sdk.StripeClient,
    apiKey: "rk_test_sandbox_key",
    webhookSecret: "whsec_test_secret",
    ...overrides
  });
  return { ...sdk, provider };
}

test("adapter accepts only test keys and constructs an instance client", async () => {
  const { calls, provider } = setup();
  assert.equal(calls.key, "rk_test_sandbox_key");
  assert.equal(calls.options.apiVersion, API_VERSION);
  assert.deepEqual(await provider.health(), { ok: true, provider: "stripe_test", mode: "test", apiVersion: API_VERSION });
});

test("live keys are rejected before SDK construction", () => {
  const sdk = makeSdk();
  assert.throws(() => createStripeTestProvider({
    StripeClient: sdk.StripeClient,
    apiKey: "sk_live_do_not_use",
    webhookSecret: "whsec_test_secret"
  }), error => error.code === "STRIPE_TEST_KEY_ONLY");
});

test("one-time checkout uses server-supplied amount and idempotency", async () => {
  const { calls, provider } = setup();
  const result = await provider.createOneTimeCheckout({
    orderId: "order_123", customerId: "customer_123", productName: "Delivery",
    currency: "KZT", amountMinor: 250000, successUrl: "https://samurai.example/success",
    cancelUrl: "https://samurai.example/cancel", idempotencyKey: "delivery:order_123"
  });
  assert.equal(result.mode, "test");
  assert.equal(calls.checkout[0].params.line_items[0].price_data.unit_amount, 250000);
  assert.equal(calls.checkout[0].params.payment_method_types, undefined);
  assert.equal(calls.checkout[0].opts.idempotencyKey, "delivery:order_123");
  assert.equal(calls.checkout[0].params.metadata.samurai_order_id, "order_123");
  assert.match(calls.checkout[0].params.metadata.samurai_checkout_ref, /^delivery_[A-Z]{8}$/);
  assert.equal(calls.checkout[0].params.integration_identifier, undefined);
});

test("subscription checkout accepts a Stripe Price ID, not a client amount", async () => {
  const { calls, provider } = setup();
  await provider.createSubscriptionCheckout({
    customerId: "customer_123", planId: "pro", priceId: "price_ABC123",
    successUrl: "https://samurai.example/success", cancelUrl: "https://samurai.example/pricing",
    idempotencyKey: "saas:customer_123:pro"
  });
  assert.equal(calls.checkout[0].params.mode, "subscription");
  assert.equal(calls.checkout[0].params.line_items[0].price, "price_ABC123");
  assert.equal(calls.checkout[0].params.line_items[0].price_data, undefined);
});

test("webhook verification requires raw bytes and signature", async () => {
  const { calls, provider } = setup();
  await assert.rejects(() => provider.verifyWebhook("{\"id\":\"evt\"}", { "stripe-signature": "sig" }),
    error => error.code === "STRIPE_WEBHOOK_RAW_BODY_REQUIRED");
  const body = Buffer.from("{\"id\":\"evt\"}");
  const event = await provider.verifyWebhook(body, { "stripe-signature": "sig_test" });
  assert.equal(event.id, "evt_test_123");
  assert.equal(calls.webhook[0].body, body);
  assert.equal(calls.webhook[0].secret, "whsec_test_secret");
});

test("refund requires a trusted PaymentIntent ID and idempotency key", async () => {
  const { calls, provider } = setup();
  await assert.rejects(() => provider.refund({ paymentIntentId: "ch_123", idempotencyKey: "refund:123" }),
    error => error.code === "PAYMENT_REFERENCE_INVALID");
  await provider.refund({ paymentIntentId: "pi_123", idempotencyKey: "refund:123" });
  assert.equal(calls.refunds[0].params.payment_intent, "pi_123");
});

test("invalid webhook signing secret is rejected", () => {
  const sdk = makeSdk();
  assert.throws(() => createStripeTestProvider({
    StripeClient: sdk.StripeClient, apiKey: "sk_test_ok", webhookSecret: "not-a-secret"
  }), error => error.code === "STRIPE_WEBHOOK_SECRET_INVALID");
});

test("canonical subscription lookup retrieves current state from Stripe", async () => {
  const { calls, provider } = setup();
  const subscription = await provider.retrieveSubscription("sub_test_123");
  assert.equal(subscription.status, "active");
  assert.deepEqual(calls.subscriptions, ["sub_test_123"]);
  await assert.rejects(() => provider.retrieveSubscription("not-a-subscription"),
    error => error.code === "PAYMENT_SUBSCRIPTION_ID_INVALID");
});
