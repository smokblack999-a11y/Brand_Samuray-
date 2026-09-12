"use strict";

const { createStore } = require("./nexus-job-store");

function createWorker({ store = createStore(), handler = async () => {}, concurrency = 1 } = {}) {
  if (concurrency !== 1) throw new Error("NEXUS worker currently supports concurrency=1 only");
  let running = false;

  async function tick() {
    if (running) return { processed: false, reason: "busy" };
    const job = store.list({ status: "QUEUED" })[0];
    if (!job) return { processed: false, reason: "empty" };
    running = true;
    store.update(job.jobId, { status: "RUNNING", startedAt: new Date().toISOString() });
    try {
      const result = await handler(job);
      const finalJob = store.update(job.jobId, { status: "COMPLETED", result });
      return { processed: true, job: finalJob };
    } catch (error) {
      const finalJob = store.update(job.jobId, {
        status: "FAILED",
        error: String(error?.message || "worker failure")
      });
      return { processed: true, job: finalJob };
    } finally {
      running = false;
    }
  }

  return { tick, isRunning: () => running };
}

module.exports = { createWorker };
