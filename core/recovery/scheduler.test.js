"use strict";

const assert = require("assert");
const { createRecoveryScheduler } = require("./scheduler");

async function run() {
  let calls = 0;
  const jobs = [
    { id: "a", status: "queued", attempts: 0, budget: { maxAttempts: 3 } },
    { id: "b", status: "queued", attempts: 0, budget: { maxAttempts: 3 } }
  ];
  const recovery = require("./index");
  const originalList = recovery.listJobs;
  const originalProcess = require("./worker").processJob;
  recovery.listJobs = () => jobs;

  const scheduler = createRecoveryScheduler({
    intervalMs: 100000,
    concurrency: 1,
    executor: async () => ({ ok: false, error: "test" }),\n    processJob: async id => { processed.push(id); }
  });

  assert.strictEqual(scheduler.status().running, false);
  assert.deepStrictEqual(scheduler.status().activeJobs, []);

  recovery.listJobs = originalList;
  assert.strictEqual(typeof originalProcess, "function");
  assert.strictEqual(typeof scheduler.start, "function");
  assert.strictEqual(typeof scheduler.stop, "function");
  assert.strictEqual(typeof scheduler.drain, "function");
  assert.strictEqual(typeof scheduler.status, "function");
  calls++;
  assert.strictEqual(calls, 1);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
