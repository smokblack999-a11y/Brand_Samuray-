"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramCommerceDelivery } = require("../commerce-telegram-adapter");

function makeOrder(overrides = {}) {
  return {
    id: "SAM-AB12CD34",
    customerId: "customer-chat-101",
    items: [{ name: "Sample item", quantity: 2 }],
    totalKzt: 3500,
    fulfilment: "delivery",
    address: "Almaty, Test Street 1",
    pickupPoint: "",
    phone: "+77001234567",
    note: "Call on arrival",
    courierId: "courier-chat-202",
    deliveryProof: { photoUrl: "https://media.example.test/proof.jpg", note: "Left with customer" },
    ...overrides
  };
}

test("OrderPlaced sends a safe customer message and flattens control characters", async () => {
  const sent = [];
  const adapter = createTelegramCommerceDelivery({ sendMessage: async p => sent.push(p) });
  const order = makeOrder({ items: [{ name: "Product\nFake payment approved", quantity: 1 }] });
  await adapter.deliver({ event: { eventId: "e-1", type: "OrderPlaced", orderId: order.id }, order });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, order.customerId);
  assert.match(sent[0].text, /ожидает оплаты/);
  assert.match(sent[0].text, /Product Fake payment approved/);
  assert.doesNotMatch(sent[0].text, /\nFake payment approved/);
  assert.match(sent[0].text, /Не переводите деньги/);
});

test("paid delivery requires dispatcher configuration before sending", async () => {
  const sent = [];
  const adapter = createTelegramCommerceDelivery({ sendMessage: async p => sent.push(p), dispatchChatId: "" });
  const order = makeOrder();
  await assert.rejects(adapter.deliver({ event: { type: "PaymentConfirmed", orderId: order.id }, order }), { code: "COMMERCE_DISPATCH_NOT_CONFIGURED" });
  assert.equal(sent.length, 0);
});

test("PaymentConfirmed informs dispatcher without leaking address or phone", async () => {
  const sent = [];
  const order = makeOrder();
  const adapter = createTelegramCommerceDelivery({ sendMessage: async p => sent.push(p), dispatchChatId: "dispatch-chat-9" });
  await adapter.deliver({ event: { type: "PaymentConfirmed", orderId: order.id }, order });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chat_id, "dispatch-chat-9");
  assert.equal(sent[1].chat_id, order.customerId);
  assert.match(sent[0].text, /Нужно назначить курьера/);
  assert.doesNotMatch(sent[0].text, /Test Street|77001234567/);
  assert.match(sent[1].text, /Оплата по заказу/);
});

test("CourierAssigned sends delivery details only to assigned courier and status to customer", async () => {
  const sent = [];
  const order = makeOrder();
  const adapter = createTelegramCommerceDelivery({ sendMessage: async p => sent.push(p) });
  await adapter.deliver({ event: { type: "CourierAssigned", orderId: order.id }, order });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chat_id, order.courierId);
  assert.match(sent[0].text, /Test Street 1/);
  assert.match(sent[0].text, /77001234567/);
  assert.equal(sent[1].chat_id, order.customerId);
  assert.doesNotMatch(sent[1].text, /Test Street|77001234567/);
});

test("delivery completion sends proof link to customer", async () => {
  const sent = [];
  const order = makeOrder();
  const adapter = createTelegramCommerceDelivery({ sendMessage: async p => sent.push(p) });
  await adapter.deliver({ event: { type: "OrderDelivered", orderId: order.id }, order });
  assert.equal(sent[0].chat_id, order.customerId);
  assert.match(sent[0].text, /доставка завершена/);
  assert.match(sent[0].text, /https:\/\/media.example.test\/proof.jpg/);
});

test("adapter rejects mismatched and unsupported events and propagates transport failures", async () => {
  const adapter = createTelegramCommerceDelivery({ sendMessage: async () => { throw new Error("network down"); } });
  const order = makeOrder();
  await assert.rejects(adapter.deliver({ event: { type: "OrderPlaced", orderId: "other" }, order }), { code: "INVALID_COMMERCE_EVENT" });
  await assert.rejects(adapter.deliver({ event: { type: "Mystery", orderId: order.id }, order }), { code: "UNSUPPORTED_COMMERCE_EVENT" });
  await assert.rejects(adapter.deliver({ event: { type: "OrderPlaced", orderId: order.id }, order }), /network down/);
});
