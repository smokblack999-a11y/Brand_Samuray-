"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPersistentQueue } = require("./persistent-queue");
const { createX29QueueWorker } = require("./x29-queue-worker");

test("queue survives a new queue instance", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x29-"));
  const file = path.join(dir, "queue.json");
  const first = createPersistentQueue(file);
  first.enqueue({ id: "github:repo:1:failure", repo: "repo" });

  const second = createPersistentQueue(file);
  assert.equal(second.list()[0].id, "github:repo:1:failure");
  assert.equal(second.list()[0].queueStatus, "queued");
});

test("duplicate workflow job is not enqueued twice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x29-"));
  const queue = createPersistentQueue(path.join(dir, "queue.json"));
  assert.equal(queue.enqueue({ id: "same" }).claimed, true);
  assert.equal(queue.enqueue({ id: "same" }).claimed, false);
  assert.equal(queue.list().length, 1);
});

test("worker persists completed result", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x29-"));
  const queue = createPersistentQueue(path.join(dir, "queue.json"));
  queue.enqueue({ id: "job-1" });

  const worker = createX29QueueWorker({
    queue,
    handler: async item => ({ architect: "planned", id: item.id }),
    maxAttempts: 2
  });

  const result = await worker.processOnce();
  assert.equal(result.queueStatus, "completed");
  assert.equal(result.result.value.architect, "planned");
});
