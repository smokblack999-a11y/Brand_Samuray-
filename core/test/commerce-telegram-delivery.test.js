"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramCommerceDelivery } = require("../commerce-telegram-delivery");

function fixture(eventType = "PaymentConfirmed") {
  return {
    event: { eventId: "event-1", type: eventType, orderId: "SAM-ABC" },
    order: {
      id: "SAM-ABC", customerId: "12345", status: "paid", totalKzt: 2500,
      fulfilment: "delivery", payment: { status: "paid" },
      address: "Almaty, Test street 1", phone: "+77000000000", note: ""
    },
    idempotencyKey: "event-1"
  };
}

test("payment confirmation notifies customer only; courier is a separate event", async () => {
  const calls = [];
  const delivery = createTelegramCommerceDelivery({
    token: "test-token",
    courierChatId: "courier-1",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: calls.length } }) };
    }
  });
  await delivery.deliver(fixture("PaymentConfirmed"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, "12345");
  assert.match(calls[0].body.text, /Оплата подтверждена/);
  await delivery.deliver(fixture("CourierDeliveryRequested"));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.chat_id, "courier-1");
  assert.match(calls[1].body.text, /Almaty, Test street 1/);
});

test("courier event refuses unpaid or pickup orders", async () => {
  let calls = 0;
  const delivery = createTelegramCommerceDelivery({
    token: "test-token", courierChatId: "courier-1",
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
  });
  const unpaid = fixture("CourierDeliveryRequested");
  unpaid.order.payment.status = "pending";
  await assert.rejects(delivery.deliver(unpaid), /paid delivery order/);
  const pickup = fixture("CourierDeliveryRequested");
  pickup.order.fulfilment = "pickup";
  await assert.rejects(delivery.deliver(pickup), /paid delivery order/);
  assert.equal(calls, 0);
});

test("Telegram API failures do not expose bot token", async () => {
  const token = "123456:SECRET_TEST_TOKEN";
  const delivery = createTelegramCommerceDelivery({
    token,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: "unauthorized" }) })
  });
  await assert.rejects(delivery.deliver(fixture("OrderPlaced")), error => {
    assert.equal(error.message.includes(token), false);
    assert.match(error.message, /HTTP 401/);
    return true;
  });
});

test("unknown event types and mismatched event IDs are rejected", async () => {
  const delivery = createTelegramCommerceDelivery({
    token: "test-token",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  });
  await assert.rejects(delivery.deliver(fixture("Unexpected")), /Unsupported commerce event type/);
  const invalid = fixture("OrderPlaced");
  invalid.idempotencyKey = "wrong";
  await assert.rejects(delivery.deliver(invalid), /Invalid commerce outbox delivery payload/);
});
