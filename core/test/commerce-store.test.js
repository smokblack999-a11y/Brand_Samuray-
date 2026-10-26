"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CommerceStore } = require("../commerce-store");

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-commerce-"));
  const catalogFile = path.join(dir, "catalog.json");
  await fs.writeFile(catalogFile, JSON.stringify({
    mode: "test",
    products: [
      { sku: "guide", name: "Demo guide", type: "digital", priceMinor: 1990, currency: "KZT", stock: 2, deliveryText: "demo content", active: true },
      { sku: "box", name: "Demo box", type: "physical", priceMinor: 4990, currency: "KZT", stock: 1, physicalInstructions: "demo only", active: true }
    ]
  }));
  const store = await new CommerceStore({ dataDir: dir, catalogFile }).init();
  return { dir, store };
}

test("catalog hides digital delivery content", async () => {
  const { dir, store } = await fixture();
  try {
    const product = store.listProducts().find(p => p.sku === "guide");
    assert.ok(product);
    assert.equal("deliveryText" in product, false);
    assert.equal(product.available, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("test order reserves stock and simulated payment fulfills idempotently", async () => {
  const { dir, store } = await fixture();
  try {
    const order = await store.createOrder({ sku: "guide", quantity: 1, customerId: "client-1" });
    assert.equal(store.listProducts().find(p => p.sku === "guide").stock, 1);
    const paid = await store.simulatePayment(order.id);
    assert.equal(paid.status, "fulfilled_test");
    assert.equal(paid.paymentMode, "test_only_no_money_moved");
    assert.equal(paid.delivery.kind, "digital_test");
    const second = await store.simulatePayment(order.id);
    assert.equal(second.status, "fulfilled_test");
    assert.equal(store.listProducts().find(p => p.sku === "guide").stock, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("order lookup enforces optional customer ownership", async () => {
  const { dir, store } = await fixture();
  try {
    const order = await store.createOrder({ sku: "guide", quantity: 1, customerId: "client-1" });
    assert.equal(store.getOrder(order.id, "client-2"), null);
    assert.equal(store.getOrder(order.id, "client-1").id, order.id);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("cancelling unpaid order restores stock once", async () => {
  const { dir, store } = await fixture();
  try {
    const order = await store.createOrder({ sku: "box", quantity: 1, customerId: "client-1" });
    assert.equal(store.listProducts().find(p => p.sku === "box").stock, 0);
    await store.cancelOrder(order.id, "client-1");
    await store.cancelOrder(order.id, "client-1");
    assert.equal(store.listProducts().find(p => p.sku === "box").stock, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("paid test order cannot be cancelled", async () => {
  const { dir, store } = await fixture();
  try {
    const order = await store.createOrder({ sku: "guide", quantity: 1, customerId: "client-1" });
    await store.simulatePayment(order.id);
    await assert.rejects(store.cancelOrder(order.id, "client-1"), /PAID_ORDER_CANNOT_BE_CANCELLED/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
