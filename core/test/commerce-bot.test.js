"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-commerce-bot-"));
process.env.DATA_DIR = dataDir;
process.env.COMMERCE_CURRENCY = "KZT";
process.env.COMMERCE_PRODUCTS_JSON = JSON.stringify([{ id: "sample-1", name: "Тестовый товар", priceKzt: 5000 }]);
process.env.COMMERCE_DELIVERY_ZONES_JSON = JSON.stringify({ "Алматы-1": 700 });
process.env.TELEGRAM_BOT_TOKEN = "test-token-not-real";
process.env.COMMERCE_COURIER_IDS = "801,802";
process.env.COMMERCE_ADMIN_IDS = "700";

const commerce = require("../commerce");
const bot = require("../commerce-bot");

function createPaidDeliveryOrder() {
  const order = commerce.createOrder({
    customerId: "500", productId: "sample-1", quantity: 1,
    fulfillment: "delivery", address: "Алматы, улица Тестовая, 1", deliveryZone: "Алматы-1"
  });
  commerce.attachCheckoutSession(order.id, "cs_test_notify_" + order.id.slice(-4));
  return commerce.applyVerifiedPayment({
    verified: true,
    eventId: "evt_notify_" + order.id,
    orderId: order.id,
    sessionId: commerce.getOrder(order.id).checkoutSessionId,
    amountKzt: order.totalKzt,
    currency: "KZT",
    provider: "stripe_test"
  }).order;
}

function telegramResponse(ok = true) {
  return {
    ok: ok ? true : false,
    status: ok ? 200 : 403,
    json: async () => ({ ok, result: ok ? { message_id: 1 } : undefined, description: ok ? undefined : "Forbidden: bot was blocked" })
  };
}

test("payment notifications are persisted per recipient and a completed retry sends nothing twice", async (t) => {
  commerce.resetForTests();
  const order = createPaidDeliveryOrder();
  const deliveries = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    deliveries.push({ url, payload: JSON.parse(options.body) });
    return telegramResponse(true);
  });

  await bot.notifyPaidOrder(order);
  assert.deepEqual(deliveries.map((x) => String(x.payload.chat_id)).sort(), ["500", "801", "802"]);
  const stored = commerce.getOrder(order.id);
  assert.ok(stored.notifications.customerSentAt);
  assert.deepEqual(stored.notifications.courierSentIds.sort(), ["801", "802"]);
  assert.deepEqual(stored.notifications.adminSentIds, []);

  await bot.notifyPaidOrder(order);
  assert.equal(deliveries.length, 3);
});

test("failed courier notification is retried without duplicating customer or already-notified courier messages", async (t) => {
  commerce.resetForTests();
  const order = createPaidDeliveryOrder();
  const failedCourierIds = new Set(["801"]);
  const deliveries = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const payload = JSON.parse(options.body);
    deliveries.push({ chatId: String(payload.chat_id), payload });
    return telegramResponse(!failedCourierIds.has(String(payload.chat_id)));
  });

  await bot.notifyPaidOrder(order);
  let stored = commerce.getOrder(order.id);
  assert.ok(stored.notifications.customerSentAt);
  assert.deepEqual(stored.notifications.courierSentIds, ["802"]);
  assert.equal(deliveries.filter((x) => x.chatId === "500").length, 1);

  failedCourierIds.clear();
  await bot.notifyPaidOrder(order);
  stored = commerce.getOrder(order.id);
  assert.deepEqual(stored.notifications.courierSentIds.sort(), ["801", "802"]);
  assert.equal(deliveries.filter((x) => x.chatId === "500").length, 1);
  assert.equal(deliveries.filter((x) => x.chatId === "802").length, 1);
  assert.equal(deliveries.filter((x) => x.chatId === "801").length, 2);
});
