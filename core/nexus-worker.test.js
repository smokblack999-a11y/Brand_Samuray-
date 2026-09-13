"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStore } = require("./nexus-job-store");
const { createWorker } = require("./nexus-worker");

test("worker claims one job and persists completion", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-worker-"));
  const store = createStore(path.join(dir, "jobs.json"));
  store.enqueue({ jobId: "job-1", repository: "repo", runId: "1" });
  const worker = createWorker({ store, handler: async (job) => ({ proofId: `proof-${job.jobId}` }) });
  const result = await worker.tick();
  assert.equal(result.processed, true);
  assert.equal(store.get("job-1").status, "COMPLETED");
  assert.equal(store.get("job-1").result.proofId, "proof-job-1");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("worker records failures instead of losing jobs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-worker-fail-"));
  const store = createStore(path.join(dir, "jobs.json"));
  store.enqueue({ jobId: "job-2" });
  const worker = createWorker({ store, handler: async () => { throw new Error("boom"); } });
  await worker.tick();
  assert.equal(store.get("job-2").status, "FAILED");
  assert.equal(store.get("job-2").error, "boom");
  fs.rmSync(dir, { recursive: true, force: true });
});
