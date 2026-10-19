"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCommerceService } = require("../commerce");
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-commerce-"));
  const filePath = path.join(dir, "commerce.json");
  return { dir, filePath, service: createCommerceService({ filePath }), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test("catalog, stock reservation and totals use server prices", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "A-1", name: "Test item", priceKzt: 2500, stock: 4 });
  const o = c.service.createOrder({ customerId: "tg-100", items: [{ productId: p.id, quantity: 2 }], fulfilment: "delivery", address: "Test address" });
  assert.equal(o.totalKzt, 5000); assert.equal(o.items[0].unitPriceKzt, 2500); assert.equal(c.service.listProducts()[0].stock, 2);
});
test("duplicate SKU and overselling are rejected", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "X", name: "X", priceKzt: 100, stock: 1 });
  assert.throws(() => c.service.addProduct({ sku: "x", name: "Duplicate", priceKzt: 100, stock: 1 }), { code: "SKU_EXISTS" });
  assert.throws(() => c.service.createOrder({ customerId: "1", items: [{ productId: p.id, quantity: 2 }], fulfilment: "delivery", address: "A" }), { code: "INSUFFICIENT_STOCK" });
});
test("receipt alone is not payment and amount must match", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "PAY", name: "Item", priceKzt: 1000, stock: 2 });
  const o = c.service.createOrder({ customerId: "1", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "A" });
  assert.throws(() => c.service.confirmPayment({ orderId: o.id, eventId: "fake", amountKzt: 1000, method: "manual_review" }), { code: "PAYMENT_NOT_VERIFIED" });
  assert.throws(() => c.service.confirmPayment({ orderId: o.id, eventId: "wrong", amountKzt: 999, method: "bank_api", trusted: true }), { code: "PAYMENT_AMOUNT_MISMATCH" });
  assert.equal(c.service.confirmPayment({ orderId: o.id, eventId: "bank-1", amountKzt: 1000, method: "bank_api", trusted: true }).payment.status, "paid");
});
test("payment event idempotency prevents reuse for another order", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "IDEMP", name: "Item", priceKzt: 500, stock: 3 });
  const a = c.service.createOrder({ customerId: "1", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "A" });
  const b = c.service.createOrder({ customerId: "2", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "B" });
  c.service.confirmPayment({ orderId: a.id, eventId: "evt-1", amountKzt: 500, method: "provider_webhook", trusted: true });
  assert.throws(() => c.service.confirmPayment({ orderId: b.id, eventId: "evt-1", amountKzt: 500, method: "provider_webhook", trusted: true }), { code: "PAYMENT_EVENT_CONFLICT" });
});
test("delivery requires assigned courier and proof; state survives restart", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "SHIP", name: "Item", priceKzt: 100, stock: 2 });
  const o = c.service.createOrder({ customerId: "tg-customer", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "A" });
  c.service.confirmPayment({ orderId: o.id, eventId: "evt-ship", amountKzt: 100, method: "bank_api", trusted: true });
  c.service.assignCourier({ orderId: o.id, courierId: "tg-courier" });
  assert.throws(() => c.service.startDelivery({ orderId: o.id, courierId: "other" }), { code: "INVALID_ORDER_STATE" });
  c.service.startDelivery({ orderId: o.id, courierId: "tg-courier" });
  c.service.confirmFulfilment({ orderId: o.id, actorId: "tg-courier", photoUrl: "https://media.example.test/proof.jpg" });
  const restarted = createCommerceService({ filePath: c.filePath });
  assert.equal(restarted.getOrder(o.id).status, "delivered");
});
test("pickup flow and cancellation restore stock; corrupt state fails closed", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "PICK", name: "Item", priceKzt: 100, stock: 2 });
  const o = c.service.createOrder({ customerId: "tg-1", items: [{ productId: p.id, quantity: 1 }], fulfilment: "pickup", pickupPoint: "Post office district" });
  c.service.confirmPayment({ orderId: o.id, eventId: "evt-pick", amountKzt: 100, method: "provider_webhook", trusted: true });
  c.service.markReadyForPickup({ orderId: o.id });
  assert.equal(c.service.confirmFulfilment({ orderId: o.id, actorId: "tg-1", photoUrl: "https://media.example.test/pickup.jpg" }).status, "picked_up");
  const unpaid = c.service.createOrder({ customerId: "tg-2", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "B" });
  c.service.cancelOrder({ orderId: unpaid.id, actorId: "tg-2" });
  assert.equal(c.service.listProducts()[0].stock, 1);
  fs.writeFileSync(c.filePath, "{broken");
  assert.throws(() => createCommerceService({ filePath: c.filePath }), { code: "COMMERCE_STATE_CORRUPT" });
});

test("transactional outbox is persisted with order and recovers across restart", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "OUTBOX", name: "Item", priceKzt: 700, stock: 2 });
  const o = c.service.createOrder({ customerId: "tg-outbox", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "Private address" });
  const placed = c.service.listOutbox().filter(e => e.type === "OrderPlaced");
  assert.equal(placed.length, 1);
  assert.equal(placed[0].orderId, o.id);
  assert.equal(Object.hasOwn(placed[0], "address"), false);
  const restarted = createCommerceService({ filePath: c.filePath });
  assert.equal(restarted.listOutbox()[0].eventId, placed[0].eventId);
  restarted.markOutboxFailed({ eventId: placed[0].eventId, error: "Telegram timeout" });
  assert.equal(restarted.listOutbox()[0].attempts, 1);
  assert.equal(restarted.listOutbox()[0].lastError, "Telegram timeout");
  restarted.markOutboxDelivered({ eventId: placed[0].eventId });
  assert.equal(restarted.listOutbox().length, 0);
  assert.equal(createCommerceService({ filePath: c.filePath }).listOutbox().length, 0);
});
test("duplicate payment event does not create duplicate outbox event", t => {
  const c = setup(); t.after(c.cleanup);
  const p = c.service.addProduct({ sku: "OUTPAY", name: "Item", priceKzt: 800, stock: 2 });
  const o = c.service.createOrder({ customerId: "tg-pay", items: [{ productId: p.id, quantity: 1 }], fulfilment: "delivery", address: "A" });
  c.service.confirmPayment({ orderId: o.id, eventId: "pay-out-1", amountKzt: 800, method: "bank_api", trusted: true });
  assert.equal(c.service.listOutbox().filter(e => e.type === "PaymentConfirmed").length, 1);
  assert.equal(c.service.confirmPayment({ orderId: o.id, eventId: "pay-out-1", amountKzt: 800, method: "bank_api", trusted: true }).payment.status, "paid");
  assert.equal(c.service.listOutbox().filter(e => e.type === "PaymentConfirmed").length, 1);
});

test("outbox migrates legacy state and rejects null/corrupt state", t => {
  const c = setup(); t.after(c.cleanup);
  fs.writeFileSync(c.filePath, JSON.stringify({ version: 1, products: [], orders: [], paymentEvents: [] }));
  const migrated = createCommerceService({ filePath: c.filePath });
  assert.deepEqual(migrated.listOutbox(), []);
  fs.writeFileSync(c.filePath, "null");
  assert.throws(() => createCommerceService({ filePath: c.filePath }), { code: "COMMERCE_STATE_INVALID" });
});
