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

test("invalid catalog configuration returns a safe Telegram message instead of retrying forever", async (t) => {
  const original = process.env.COMMERCE_PRODUCTS_JSON;
  const payloads = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return telegramResponse(true);
  });
  process.env.COMMERCE_PRODUCTS_JSON = "not-json";
  try {
    const result = await bot.handleCommerceUpdate({
      update_id: 908,
      message: { message_id: 2, chat: { id: 500, type: "private" }, from: { id: 500, is_bot: false }, text: "/catalog" }
    });
    assert.equal(result.handledError, true);
    const reply = payloads.find((p) => p.method === undefined && p.text);
    assert.ok(reply);
    assert.match(reply.text, /Не удалось обработать запрос/);
    assert.equal(reply.text.includes("COMMERCE_PRODUCTS_JSON"), false);
    assert.equal(reply.text.includes("not-json"), false);
  } finally {
    if (original === undefined) delete process.env.COMMERCE_PRODUCTS_JSON;
    else process.env.COMMERCE_PRODUCTS_JSON = original;
  }
});

test("commerce messages from group chats are ignored to protect delivery addresses", async (t) => {
  commerce.resetForTests();
  let telegramCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    telegramCalls += 1;
    return telegramResponse(true);
  });
  await bot.handleCommerceUpdate({
    update_id: 909,
    message: {
      message_id: 1,
      chat: { id: -10000001, type: "supergroup" },
      from: { id: 500, is_bot: false },
      text: "/catalog"
    }
  });
  assert.equal(telegramCalls, 0);
  assert.equal(commerce.listOrders().length, 0);
});

test("Telegram customer can select a quantity and the server creates the matching unpaid order", async (t) => {
  commerce.resetForTests();
  process.env.STRIPE_SECRET_KEY = "";
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const payload = JSON.parse(options.body);
    sent.push(payload);
    return telegramResponse(true);
  });
  const callback = (updateId, data) => ({
    update_id: updateId,
    callback_query: {
      id: "cb-" + updateId,
      from: { id: 500 },
      message: { chat: { id: 500, type: "private" } },
      data
    }
  });

  await bot.handleCommerceUpdate(callback(910, "product:sample-1"));
  assert.ok(sent.some((p) => p.reply_markup?.inline_keyboard?.[0]?.some((b) => b.callback_data === "quantity:sample-1:3")));

  sent.length = 0;
  await bot.handleCommerceUpdate(callback(911, "quantity:sample-1:3"));
  assert.ok(sent.some((p) => p.reply_markup?.inline_keyboard?.[0]?.some((b) => b.callback_data === "buy:pickup:sample-1:3")));

  sent.length = 0;
  await bot.handleCommerceUpdate(callback(912, "buy:pickup:sample-1:3"));
  const orders = commerce.listOrders({ customerId: "500" });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].quantity, 3);
  assert.equal(orders[0].itemsTotalKzt, 15000);
  assert.equal(orders[0].paymentStatus, "AWAITING_PAYMENT");
  assert.ok(sent.some((p) => String(p.text || "").includes("Оплата не подтверждена")));
});

test("private Telegram admin and courier commands expose the right order actions", async (t) => {
  commerce.resetForTests();
  const order = createPaidDeliveryOrder();
  const messages = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    messages.push(JSON.parse(options.body));
    return telegramResponse(true);
  });
  const messageUpdate = (updateId, userId, text) => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false },
      text
    }
  });

  await bot.handleCommerceUpdate(messageUpdate(919, 500, "/orders"));
  const denied = messages.find((p) => String(p.text || "").includes("Нет доступа"));
  assert.ok(denied);
  assert.equal(denied.text.includes(order.address), false);

  messages.length = 0;
  await bot.handleCommerceUpdate(messageUpdate(920, 700, "/admin"));
  assert.ok(messages.some((p) => String(p.text || "").includes("Доставка без курьера: 1")));

  messages.length = 0;
  await bot.handleCommerceUpdate(messageUpdate(921, 700, "/order " + order.id));
  assert.ok(messages.some((p) => String(p.text || "").includes(order.address)));
  assert.ok(messages.some((p) => String(p.text || "").includes(order.id)));

  commerce.assignCourier(order.id, "801");
  messages.length = 0;
  await bot.handleCommerceUpdate(messageUpdate(922, 801, "/mydelivery"));
  assert.ok(messages.some((p) => String(p.text || "").includes(order.address)));

  messages.length = 0;
  await bot.handleCommerceUpdate(messageUpdate(923, 801, "/startdelivery " + order.id));
  assert.equal(commerce.getOrder(order.id).status, "IN_DELIVERY");
  assert.ok(messages.some((p) => String(p.text || "").includes("передан курьеру")));
});

test("courier Telegram photo is attached to the assigned paid order and delivered to its customer", async (t) => {
  commerce.resetForTests();
  const paid = createPaidDeliveryOrder();
  commerce.assignCourier(paid.id, "801");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return telegramResponse(true);
  });
  await bot.handleCommerceUpdate({
    update_id: 930,
    message: { message_id: 1, chat: { id: 801, type: "private" }, from: { id: 801, is_bot: false }, text: "/photo " + paid.id }
  });
  await bot.handleCommerceUpdate({
    update_id: 931,
    message: {
      message_id: 2,
      chat: { id: 801, type: "private" },
      from: { id: 801, is_bot: false },
      caption: "GPS: 43.238900, 76.889700",
      photo: [{ file_id: "file-small" }, { file_id: "file-large" }]
    }
  });
  const saved = commerce.getOrder(paid.id);
  assert.equal(saved.status, "PHOTO_RECEIVED");
  assert.equal(saved.proof.telegramFileId, "file-large");
  assert.equal(saved.proof.latitude, 43.2389);
  assert.equal(saved.proof.longitude, 76.8897);
  assert.ok(saved.proof.customerSentAt);
  const customerPhoto = calls.find((c) => c.url.endsWith("/sendPhoto") && String(c.payload.chat_id) === "500");
  assert.ok(customerPhoto);
  assert.equal(customerPhoto.payload.photo, "file-large");
  assert.ok(customerPhoto.payload.caption.includes(paid.id));
});

test("concurrent delivery of the same Telegram update is handled only once", async (t) => {
  commerce.resetForTests();
  let calls = 0;
  let signalStarted;
  let releaseFirst;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseFirst = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, _options) => {
    calls += 1;
    if (calls === 1) {
      signalStarted();
      await blocked;
    }
    return telegramResponse(true);
  });
  const update = {
    update_id: 940,
    callback_query: {
      id: "cb-940",
      from: { id: 500 },
      message: { chat: { id: 500, type: "private" } },
      data: "product:sample-1"
    }
  };
  const first = bot.handleCommerceUpdate(update);
  await started;
  const concurrent = await bot.handleCommerceUpdate(update);
  assert.equal(concurrent.duplicate, true);
  assert.equal(concurrent.inFlight, true);
  releaseFirst();
  await first;
  assert.equal(calls, 2);
  assert.equal(commerce.listOrders().length, 0);
});

test("customer receipt photo is routed to administrators for review but never confirms payment", async (t) => {
  commerce.resetForTests();
  const order = commerce.createOrder({
    customerId: "500", productId: "sample-1", quantity: 1,
    fulfillment: "delivery", address: "Алматы, тестовый адрес, 1", deliveryZone: "Алматы-1"
  });
  const telegramCalls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    telegramCalls.push({ url, payload: JSON.parse(options.body) });
    return telegramResponse(true);
  });
  const update = (updateId, message) => ({ update_id: updateId, message });
  await bot.handleCommerceUpdate(update(950, {
    message_id: 950, chat: { id: 500, type: "private" }, from: { id: 500, is_bot: false },
    text: "/receipt " + order.id
  }));
  assert.ok(telegramCalls.some((call) => String(call.payload.text || "").includes("Пришлите фото чека")));

  telegramCalls.length = 0;
  await bot.handleCommerceUpdate(update(951, {
    message_id: 951, chat: { id: 500, type: "private" }, from: { id: 500, is_bot: false },
    photo: [{ file_id: "receipt-small" }, { file_id: "receipt-large", file_unique_id: "receipt-unique" }]
  }));
  const saved = commerce.getOrder(order.id);
  assert.equal(saved.status, "PAYMENT_REVIEW");
  assert.equal(saved.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(saved.paymentReceipts.length, 1);
  assert.equal(saved.paymentReceipts[0].telegramFileId, "receipt-large");
  assert.deepEqual(saved.paymentReceipts[0].adminSentIds, ["700"]);
  assert.equal(commerce.listPaymentReviewOrders().length, 1);
  assert.equal(commerce.listOrders({ status: "PAID" }).length, 0);

  const adminPhoto = telegramCalls.find((call) =>
    call.url.endsWith("/sendPhoto") && String(call.payload.chat_id) === "700"
  );
  assert.ok(adminPhoto);
  assert.equal(adminPhoto.payload.photo, "receipt-large");
  assert.match(adminPhoto.payload.caption, /ОПЛАТА НЕ ПОДТВЕРЖДЕНА/);
  const customerAck = telegramCalls.find((call) =>
    String(call.payload.chat_id) === "500" && String(call.payload.text || "").includes("Это НЕ подтверждение")
  );
  assert.ok(customerAck);
});

test("manual bank reconciliation requires explicit admin confirmation and records the audit", async (t) => {
  commerce.resetForTests();
  const order = commerce.createOrder({
    customerId: "500", productId: "sample-1", quantity: 1,
    fulfillment: "delivery", address: "Алматы, ручная сверка, 1", deliveryZone: "Алматы-1"
  });
  commerce.submitPaymentReceipt(order.id, "500", {
    telegramFileId: "manual-bank-receipt-file",
    fileUniqueId: "manual-bank-receipt-unique"
  });
  const telegramCalls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    telegramCalls.push({ url, payload: JSON.parse(options.body) });
    return telegramResponse(true);
  });
  const updateMessage = (id, userId, text) => ({
    update_id: id,
    message: {
      message_id: id, chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false }, text
    }
  });

  await bot.handleCommerceUpdate(updateMessage(960, 500, "/confirmbank " + order.id + " BANK-REF-2026-001"));
  assert.equal(commerce.getOrder(order.id).paymentStatus, "AWAITING_PAYMENT");
  assert.equal(commerce.getOrder(order.id).status, "PAYMENT_REVIEW");

  telegramCalls.length = 0;
  await bot.handleCommerceUpdate(updateMessage(961, 700, "/confirmbank " + order.id + " BANK-REF-2026-001"));
  assert.equal(commerce.getOrder(order.id).paymentStatus, "AWAITING_PAYMENT");
  assert.ok(telegramCalls.some((call) => String(call.payload.text || "").includes("ПОДТВЕРЖДЕНИЕ БАНКОВСКОГО ПЕРЕВОДА")));
  assert.ok(telegramCalls.some((call) => call.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "bank:confirm:" + order.id));

  const callback = {
    update_id: 962,
    callback_query: {
      id: "bank-confirm-callback",
      from: { id: 700 },
      message: { chat: { id: 700, type: "private" } },
      data: "bank:confirm:" + order.id
    }
  };
  await bot.handleCommerceUpdate(callback);
  const paid = commerce.getOrder(order.id);
  assert.equal(paid.paymentStatus, "PAID");
  assert.equal(paid.status, "PAID");
  assert.equal(paid.paymentProvider, "manual_bank_reconciliation");
  assert.equal(paid.paymentVerification.verifiedByAdminId, "700");
  assert.equal(paid.paymentVerification.bankReference, "BANK-REF-2026-001");
  assert.equal(paid.paymentAudit.at(-1).event, "MANUAL_BANK_PAYMENT_CONFIRMED");

  const customerNotice = telegramCalls.find((call) =>
    call.url.endsWith("/sendMessage") && String(call.payload.chat_id) === "500" &&
    String(call.payload.text || "").includes("Оплата подтверждена")
  );
  assert.ok(customerNotice);
  const courierNotice = telegramCalls.find((call) =>
    call.url.endsWith("/sendMessage") && ["801", "802"].includes(String(call.payload.chat_id)) &&
    String(call.payload.text || "").includes("Новый оплаченный заказ")
  );
  assert.ok(courierNotice);
});

test("duplicate-payment alert retries after Telegram outage and does not resend after persistence", async (t) => {
  commerce.resetForTests();
  const firstPaid = createPaidDeliveryOrder();
  const current = commerce.getOrder(firstPaid.id);
  commerce.attachCheckoutSession(current.id, "cs_test_second_paid_session");
  const duplicate = commerce.applyVerifiedPayment({
    verified: true,
    eventId: "evt_duplicate_paid_session",
    orderId: current.id,
    sessionId: "cs_test_second_paid_session",
    amountKzt: current.totalKzt,
    currency: current.currency,
    provider: "stripe_test"
  });
  assert.equal(duplicate.duplicatePayment, true);
  assert.equal(duplicate.order.duplicatePaymentIncidents.length, 1);

  let adminAttempts = 0;
  const notifications = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const payload = JSON.parse(options.body);
    notifications.push({ url, payload });
    if (String(payload.chat_id) === "700") {
      adminAttempts += 1;
      if (adminAttempts === 1) return telegramResponse(false);
    }
    return telegramResponse(true);
  });

  await bot.notifyDuplicatePayment(duplicate.order);
  assert.deepEqual(commerce.getOrder(current.id).duplicatePaymentIncidents[0].adminNotifiedIds, []);
  await bot.notifyDuplicatePayment(duplicate.order);
  assert.deepEqual(commerce.getOrder(current.id).duplicatePaymentIncidents[0].adminNotifiedIds, ["700"]);
  await bot.notifyDuplicatePayment(duplicate.order);
  assert.equal(adminAttempts, 2);
  assert.equal(notifications.filter((n) => String(n.payload.chat_id) === "700").length, 2);
  assert.ok(notifications.some((n) => String(n.payload.text || "").includes("повторный платёж")));
});

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
