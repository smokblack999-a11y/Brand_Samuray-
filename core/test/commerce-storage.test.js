"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-commerce-storage-"));
fs.writeFileSync(path.join(dataDir, "commerce-orders.json"), JSON.stringify([{
  id: "SAM-LEGACY-001",
  customerId: "12345",
  idempotencyKey: "telegram:legacy-1",
  status: "AWAITING_PAYMENT",
  paymentStatus: "AWAITING_PAYMENT",
  currency: "KZT",
  totalKzt: 5000,
  paymentEventIds: ["evt-legacy-001"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
}], null, 2) + "\n");
fs.writeFileSync(path.join(dataDir, "commerce-payment-events.json"), JSON.stringify(["evt-legacy-001"], null, 2) + "\n");
process.env.DATA_DIR = dataDir;
delete process.env.COMMERCE_DB_PATH;

const storage = require("../commerce-storage");

test("one-time migration imports legacy orders/events and preserves source files", () => {
  assert.equal(storage.readOrders().length, 1);
  assert.equal(storage.readOrders()[0].id, "SAM-LEGACY-001");
  assert.deepEqual(storage.readEvents(), ["evt-legacy-001"]);
  assert.equal(fs.existsSync(path.join(dataDir, "commerce-orders.json")), true);
  assert.equal(fs.existsSync(path.join(dataDir, "commerce-payment-events.json")), true);
});

test("a failed transaction rolls back order, payment event, and outbox writes together", () => {
  const originalOrderCount = storage.readOrders().length;
  const originalEventIds = storage.readEvents();
  assert.throws(() => storage.withTransaction(() => {
    storage.writeOrders([{
      id: "SAM-ROLLBACK-001",
      customerId: "777",
      status: "PAID",
      paymentStatus: "PAID",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z"
    }]);
    storage.writeEvents(["evt-rollback-001"]);
    storage.enqueuePaymentNotification("SAM-ROLLBACK-001");
    throw new Error("simulate transaction failure");
  }), /simulate transaction failure/);
  assert.equal(storage.readOrders().length, originalOrderCount);
  assert.deepEqual(storage.readEvents(), originalEventIds);
  assert.equal(storage.listOutboxJobsForTests().length, 0);
});

test("payment notification outbox deduplicates jobs and completes a claimed job", () => {
  storage.enqueuePaymentNotification("SAM-LEGACY-001");
  storage.enqueuePaymentNotification("SAM-LEGACY-001");
  const jobs = storage.claimPendingOutboxJobs(10);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, "payment_notifications");
  assert.equal(jobs[0].orderId, "SAM-LEGACY-001");
  assert.equal(jobs[0].attempts, 1);
  assert.equal(storage.completeOutboxJob(jobs[0].id), true);
  assert.deepEqual(storage.claimPendingOutboxJobs(10), []);
  assert.equal(storage.listOutboxJobsForTests()[0].status, "SENT");
});
