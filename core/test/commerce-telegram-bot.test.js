"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCommerceService } = require("../commerce");
const { createCommerceTelegramBot } = require("../commerce-telegram-bot");

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-commerce-bot-"));
  const commerce = createCommerceService({ filePath: path.join(dir, "commerce.json") });
  const product = commerce.addProduct({
    sku: "BOT-1",
    name: "Тестовый товар",
    priceKzt: 1500,
    stock: 20,
    description: "Описание товара",
    media: [{ type: "photo", url: "https://media.example.test/item.jpg" }]
  });
  const calls = [];
  const bot = createCommerceTelegramBot({
    commerce,
    paymentMode: "disabled",
    isProduction: true,
    dispatchChatId: "55555",
    courierChatIds: ["77777"],
    callTelegram: async (method, payload) => {
      calls.push({ method, payload });
      return { message_id: calls.length };
    },
    ...options
  });
  return {
    dir, commerce, product, calls, bot,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

function message(chatId, text, extra = {}) {
  return { message: { message_id: 10, chat: { id: Number(chatId), type: "private" }, from: { id: Number(chatId) }, text, ...extra } };
}
function callback(chatId, data, id = "callback-1", fromId = chatId) {
  return { callback_query: {
    id,
    from: { id: Number(fromId) },
    message: { message_id: 11, chat: { id: Number(chatId), type: "private" } },
    data
  } };
}
function lastMessage(calls) {
  return calls.filter(call => call.method === "sendMessage").at(-1)?.payload;
}

test("start and paginated catalog render buttons; product sends configured media", async t => {
  const c = setup(); t.after(c.cleanup);
  assert.equal(await c.bot.handleUpdate(message("12345", "/start")), true);
  assert.match(lastMessage(c.calls).text, /SAMURAI COMMERCE/);
  await c.bot.handleUpdate(callback("12345", "c:0", "cb-cat"));
  assert.match(lastMessage(c.calls).text, /Каталог/);
  assert.ok(lastMessage(c.calls).reply_markup.inline_keyboard.flat().some(button => button.callback_data === "b:" + c.product.id));
  await c.bot.handleUpdate(callback("12345", "b:" + c.product.id, "cb-product"));
  const photo = c.calls.find(call => call.method === "sendPhoto");
  assert.ok(photo);
  assert.equal(photo.payload.photo, "https://media.example.test/item.jpg");
});

test("delivery checkout creates order with server total and does not offer real payment in disabled mode", async t => {
  const c = setup(); t.after(c.cleanup);
  await c.bot.handleUpdate(callback("12345", "q:" + c.product.id + ":2", "cb-q"));
  await c.bot.handleUpdate(callback("12345", "f:d", "cb-delivery"));
  await c.bot.handleUpdate(message("12345", "Almaty, Test Street 1"));
  await c.bot.handleUpdate(message("12345", "+77001234567"));
  const orders = c.commerce.listCustomerOrders({ customerId: "12345" });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].totalKzt, 3000);
  const order = c.commerce.getOrder(orders[0].id);
  assert.equal(order.address, "Almaty, Test Street 1");
  assert.equal(order.status, "pending_payment");
  assert.doesNotMatch(lastMessage(c.calls).text, /реальные деньги/);
  assert.match(lastMessage(c.calls).text, /не подключён|Не переводите деньги/);
  assert.equal(lastMessage(c.calls).reply_markup.inline_keyboard.flat().some(button => String(button.callback_data).startsWith("t:")), false);
});

test("test payment is available only outside production in test mode", async t => {
  const c = setup({ paymentMode: "test", isProduction: false }); t.after(c.cleanup);
  await c.bot.handleUpdate(callback("12345", "q:" + c.product.id + ":1", "cb-q"));
  await c.bot.handleUpdate(callback("12345", "f:p", "cb-pickup"));
  await c.bot.handleUpdate(message("12345", "Central pickup point"));
  await c.bot.handleUpdate(message("12345", "-"));
  const [orderBrief] = c.commerce.listCustomerOrders({ customerId: "12345" });
  const createKeyboard = c.calls.filter(call => call.method === "sendMessage").at(-1).payload.reply_markup;
  const paymentButton = createKeyboard.inline_keyboard.flat().find(button => String(button.callback_data).startsWith("t:"));
  assert.ok(paymentButton);
  await c.bot.handleUpdate(callback("12345", paymentButton.callback_data, "cb-testpay"));
  const order = c.commerce.getOrder(orderBrief.id);
  assert.equal(order.payment.status, "paid");
  assert.equal(order.status, "preparing");
  assert.match(lastMessage(c.calls).text, /Реальные деньги не списаны/);
  assert.equal(c.commerce.listOutbox().filter(event => event.type === "PaymentConfirmed").length, 1);
});

test("test payment callback is blocked in production and for another customer's order", async t => {
  const c = setup({ paymentMode: "test", isProduction: true }); t.after(c.cleanup);
  const order = c.commerce.createOrder({
    customerId: "12345",
    items: [{ productId: c.product.id, quantity: 1 }],
    fulfilment: "pickup",
    pickupPoint: "Test pickup"
  });
  await c.bot.handleUpdate(callback("12345", "t:" + order.id, "cb-prod"));
  assert.equal(c.commerce.getOrder(order.id).payment.status, "pending");
  assert.match(lastMessage(c.calls).text, /отключена/);
  await c.bot.handleUpdate(callback("67890", "t:" + order.id, "cb-other", "67890"));
  assert.equal(c.commerce.getOrder(order.id).payment.status, "pending");
  assert.match(lastMessage(c.calls).text, /не найден/);
});

test("dispatcher can assign only a whitelisted courier; courier can start and submit photo proof", async t => {
  const c = setup({ paymentMode: "test", isProduction: false }); t.after(c.cleanup);
  const order = c.commerce.createOrder({
    customerId: "12345", items: [{ productId: c.product.id, quantity: 1 }],
    fulfilment: "delivery", address: "Almaty, Private address", phone: "+77001234567"
  });
  c.commerce.confirmPayment({ orderId: order.id, eventId: "trusted-test-payment", amountKzt: order.totalKzt, method: "manual_review", trusted: true });
  await c.bot.handleUpdate(callback("55555", "a:" + order.id + ":77777", "cb-assign"));
  assert.equal(c.commerce.getOrder(order.id).courierId, "77777");
  assert.equal(c.commerce.getOrder(order.id).status, "assigned");
  await c.bot.handleUpdate(callback("77777", "s:" + order.id, "cb-start"));
  assert.equal(c.commerce.getOrder(order.id).status, "out_for_delivery");
  await c.bot.handleUpdate(message("77777", "", {
    photo: [{ file_id: "small-file" }, { file_id: "largest-photo-file-id" }],
    caption: "Delivered to customer"
  }));
  const done = c.commerce.getOrder(order.id);
  assert.equal(done.status, "delivered");
  assert.equal(done.deliveryProof.photoFileId, "largest-photo-file-id");
  assert.equal(c.commerce.getConversation("77777"), null);
  assert.equal(c.commerce.listOutbox().some(event => event.type === "OrderDelivered"), true);
});

test("unauthorized dispatcher callback cannot assign a courier", async t => {
  const c = setup({ paymentMode: "test", isProduction: false }); t.after(c.cleanup);
  const order = c.commerce.createOrder({
    customerId: "12345", items: [{ productId: c.product.id, quantity: 1 }],
    fulfilment: "delivery", address: "Address"
  });
  c.commerce.confirmPayment({ orderId: order.id, eventId: "pay-security", amountKzt: order.totalKzt, method: "manual_review", trusted: true });
  await c.bot.handleUpdate(callback("99999", "a:" + order.id + ":77777", "cb-not-dispatch"));
  assert.equal(c.commerce.getOrder(order.id).courierId, null);
  assert.match(lastMessage(c.calls).text, /Недостаточно прав|устарела|меню/);
});

test("sessions persist between bot instances and pickup can be confirmed without photo", async t => {
  const c = setup({ paymentMode: "test", isProduction: false }); t.after(c.cleanup);
  await c.bot.handleUpdate(callback("12345", "q:" + c.product.id + ":1", "cb-q-pick"));
  await c.bot.handleUpdate(callback("12345", "f:p", "cb-f-pick"));
  await c.bot.handleUpdate(message("12345", "Central pickup point"));
  await c.bot.handleUpdate(message("12345", "-"));
  const [brief] = c.commerce.listCustomerOrders({ customerId: "12345" });
  const reloaded = require("../commerce").createCommerceService({
    filePath: path.join(c.dir, "commerce.json")
  });
  assert.equal(reloaded.getOrder(brief.id).fulfilment, "pickup");
  assert.equal(reloaded.getConversation("12345"), null);
  reloaded.confirmPayment({ orderId: brief.id, eventId: "pickup-test-payment", amountKzt: brief.totalKzt, method: "manual_review", trusted: true });
  reloaded.markReadyForPickup({ orderId: brief.id });
  const picked = reloaded.confirmFulfilment({ orderId: brief.id, actorId: "12345", note: "Customer collected" });
  assert.equal(picked.status, "picked_up");
  assert.equal(picked.deliveryProof.photoFileId, null);
});

test("unknown updates are ignored and private chat identity is required", async t => {
  const c = setup(); t.after(c.cleanup);
  assert.equal(await c.bot.handleUpdate({ callback_query: { id: "cb-group", from: { id: 12345 }, message: { chat: { id: -100, type: "supergroup" } }, data: "o" } }), true);
  assert.equal(await c.bot.handleUpdate({ message: { chat: { id: -100, type: "group" }, from: { id: 12345 }, text: "/start" } }), false);
});
