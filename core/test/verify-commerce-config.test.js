"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCommerceEnv } = require("../scripts/verify-commerce-config");

function validEnv(overrides = {}) {
  return {
    TELEGRAM_BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret-" + "a".repeat(24),
    TELEGRAM_WEBHOOK_URL: "https://bot.samurai-shop.kz/api/telegram/webhook",
    CORE_API_KEY: "admin-api-key-" + "b".repeat(24),
    STRIPE_SECRET_KEY: "sk_test_" + "c".repeat(32),
    STRIPE_WEBHOOK_SECRET: "whsec_" + "d".repeat(32),
    COMMERCE_SUCCESS_URL: "https://samurai-shop.kz/payment/success",
    COMMERCE_CANCEL_URL: "https://samurai-shop.kz/payment/cancel",
    COMMERCE_PRODUCTS_JSON: JSON.stringify([{ id: "item-1", name: "Test item", priceKzt: 5000 }]),
    COMMERCE_DELIVERY_ZONES_JSON: JSON.stringify({ Almaty: 1500 }),
    COMMERCE_COURIER_IDS: "123456789",
    COMMERCE_COURIER_TOKENS_JSON: JSON.stringify({ "123456789": "e".repeat(64) }),
    COMMERCE_ADMIN_IDS: "987654321",
    COMMERCE_CURRENCY: "KZT",
    ...overrides
  };
}

test("accepts a complete test-only commerce configuration without printing secrets", () => {
  const result = validateCommerceEnv(validEnv());
  assert.equal(result.ok, true);
  assert.equal(result.mode, "stripe-test-only");
  assert.deepEqual(result.checked, {
    productCount: 1,
    deliveryZoneCount: 1,
    courierCount: 1,
    adminCount: 1,
    stripeTestKeyConfigured: true,
    stripeWebhookConfigured: true
  });
  assert.equal(JSON.stringify(result).includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), false);
  assert.equal(JSON.stringify(result).includes("c".repeat(32)), false);
  assert.deepEqual(result.errors, []);
});

test("rejects live Stripe key, placeholder URLs and weak courier tokens", () => {
  const result = validateCommerceEnv(validEnv({
    STRIPE_SECRET_KEY: "sk_live_" + "x".repeat(32),
    COMMERCE_SUCCESS_URL: "https://example.com/success",
    COMMERCE_COURIER_TOKENS_JSON: JSON.stringify({ "123456789": "short-token" })
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("live Stripe mode is disabled")));
  assert.ok(result.errors.some((error) => error.includes("COMMERCE_SUCCESS_URL")));
  assert.ok(result.errors.some((error) => error.includes("upload token")));
});

test("rejects malformed catalog, duplicate product IDs and duplicate courier tokens", () => {
  const result = validateCommerceEnv(validEnv({
    COMMERCE_PRODUCTS_JSON: JSON.stringify([
      { id: "same", name: "One", priceKzt: 500 },
      { id: "same", name: "Two", priceKzt: 700 }
    ]),
    COMMERCE_COURIER_IDS: "123456789,123456790",
    COMMERCE_COURIER_TOKENS_JSON: JSON.stringify({
      "123456789": "f".repeat(64),
      "123456790": "f".repeat(64)
    })
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Product IDs must be unique")));
  assert.ok(result.errors.some((error) => error.includes("different upload token")));
});

test("rejects manual bank confirmation when production environment is configured", () => {
  const blocked = validateCommerceEnv(validEnv({
    COMMERCE_MANUAL_BANK_CONFIRM_ENABLED: "true",
    NODE_ENV: "production"
  }));
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((error) => error.includes("Manual bank confirmation is disabled in production")));

  const malformed = validateCommerceEnv(validEnv({
    COMMERCE_MANUAL_BANK_CONFIRM_ENABLED: "sometimes"
  }));
  assert.equal(malformed.ok, false);
  assert.ok(malformed.errors.some((error) => error.includes("must be true or false")));
});

test("rejects malformed JSON without echoing configuration values", () => {
  const result = validateCommerceEnv(validEnv({ COMMERCE_PRODUCTS_JSON: "invalid-secret-looking-value" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("valid JSON")));
  assert.equal(JSON.stringify(result).includes("invalid-secret-looking-value"), false);
});
