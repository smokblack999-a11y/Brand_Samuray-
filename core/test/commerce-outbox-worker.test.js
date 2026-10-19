"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCommerceService } = require("../commerce");
const { createOutboxWorker } = require("../commerce-outbox-worker");

function setupOrder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-outbox-worker-"));
  const filePath = path.join(dir, "commerce.json");
  const commerce = createCommerceService({ filePath });
  const product = commerce.addProduct({ sku: "WORKER-1", name: "Worker test item", priceKzt: 1200, stock: 5 });
  const order = commerce.createOrder({
    customerId: "test-customer",
    items: [{ productId: product.id, quantity: 1 }],
    fulfilment: "delivery",
    address: "Test address"
  });
  return { dir, filePath, commerce, order, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("outbox worker delivers event and marks it delivered", async t => {
  const c = setupOrder(); t.after(c.cleanup);
  const received = [];
  const worker = createOutboxWorker({
    commerce: c.commerce,
    deliver: async payload => received.push(payload)
  });
  const result = await worker.runOnce();
  assert.equal(result.scanned, 1);
  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0].event.type, "OrderPlaced");
  assert.equal(received[0].event.orderId, c.order.id);
  assert.equal(received[0].order.id, c.order.id);
  assert.equal(received[0].idempotencyKey, received[0].event.eventId);
  assert.equal(c.commerce.listOutbox().length, 0);
});

test("failed delivery retries the same event ID and can later succeed", async t => {
  const c = setupOrder(); t.after(c.cleanup);
  let callCount = 0;
  const ids = [];
  const worker = createOutboxWorker({
    commerce: c.commerce,
    maxAttempts: 3,
    deliver: async ({ event }) => {
      ids.push(event.eventId);
      callCount += 1;
      if (callCount === 1) throw new Error("Telegram temporarily unavailable");
    }
  });
  const first = await worker.runOnce();
  assert.equal(first.failed, 1);
  assert.equal(first.results[0].status, "pending");
  assert.equal(c.commerce.listOutbox()[0].attempts, 1);
  const second = await worker.runOnce();
  assert.equal(second.delivered, 1);
  assert.equal(ids[0], ids[1]);
  assert.equal(c.commerce.listOutbox().length, 0);
});

test("outbox moves to dead letter after bounded failures", async t => {
  const c = setupOrder(); t.after(c.cleanup);
  const worker = createOutboxWorker({
    commerce: c.commerce,
    maxAttempts: 2,
    deliver: async () => { throw new Error("downstream unavailable"); }
  });
  assert.equal((await worker.runOnce()).results[0].status, "pending");
  const second = await worker.runOnce();
  assert.equal(second.deadLettered, 1);
  assert.equal(second.results[0].status, "dead_letter");
  assert.equal(c.commerce.listOutbox().length, 0);
  const deadLetters = c.commerce.listOutbox({ includeDeadLetter: true });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].attempts, 2);
});

test("worker redacts a Telegram bot token from stored delivery errors", async t => {
  const c = setupOrder(); t.after(c.cleanup);
  const credential = "bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
  const worker = createOutboxWorker({
    commerce: c.commerce,
    maxAttempts: 1,
    deliver: async () => { throw new Error("failed URL https://api.telegram.org/" + credential + "/sendMessage"); }
  });
  const result = await worker.runOnce();
  assert.equal(result.deadLettered, 1);
  const saved = c.commerce.listOutbox({ includeDeadLetter: true })[0];
  assert.equal(saved.lastError.includes(credential), false);
  assert.match(saved.lastError, /bot\[REDACTED\]/);
});

test("one worker instance rejects overlapping runs", async t => {
  const c = setupOrder(); t.after(c.cleanup);
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const worker = createOutboxWorker({
    commerce: c.commerce,
    deliver: async () => { entered(); await gate; }
  });
  const first = worker.runOnce();
  await started;
  await assert.rejects(worker.runOnce(), { code: "WORKER_ALREADY_RUNNING" });
  release();
  assert.equal((await first).delivered, 1);
});

test("worker validates configuration", t => {
  t.after(() => {});
  assert.throws(() => createOutboxWorker({ commerce: {}, deliver() {} }), { code: "INVALID_COMMERCE_SERVICE" });
  assert.throws(() => createOutboxWorker({ commerce: { listOutbox() {}, getOrder() {}, markOutboxDelivered() {}, markOutboxFailed() {} }, deliver() {}, maxBatch: 501 }), { code: "INVALID_MAX_BATCH" });
  assert.throws(() => createOutboxWorker({ commerce: { listOutbox() {}, getOrder() {}, markOutboxDelivered() {}, markOutboxFailed() {} }, deliver() {}, maxAttempts: 101 }), { code: "INVALID_MAX_ATTEMPTS" });
});

test("dead-letter replay is explicit and retains the original event ID", async t => {
  const c = setupOrder(); t.after(c.cleanup);
  const failing = createOutboxWorker({
    commerce: c.commerce,
    maxAttempts: 1,
    deliver: async () => { throw new Error("manual review required"); }
  });
  const failed = await failing.runOnce();
  const eventId = failed.results[0].eventId;
  assert.equal(failed.deadLettered, 1);
  assert.throws(() => c.commerce.requeueOutboxDeadLetter({ eventId: "unknown" }), { code: "OUTBOX_EVENT_NOT_FOUND" });
  const requeued = c.commerce.requeueOutboxDeadLetter({ eventId });
  assert.equal(requeued.eventId, eventId);
  assert.equal(requeued.status, "pending");
  assert.equal(requeued.attempts, 0);
  assert.equal(requeued.lastDeadLetterAttempts, 1);
  const succeeded = await createOutboxWorker({ commerce: c.commerce, deliver: async ({ event }) => assert.equal(event.eventId, eventId) }).runOnce();
  assert.equal(succeeded.delivered, 1);
  assert.equal(c.commerce.listOutbox().length, 0);
});
