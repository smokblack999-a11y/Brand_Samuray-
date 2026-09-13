"use strict";

const { createStore } = require("./nexus-job-store");
const { createWorker } = require("./nexus-worker");
const { createFailureHandler } = require("./nexus-failure-handler");

const intervalMs = Math.max(1000, Number(process.env.NEXUS_WORKER_INTERVAL_MS || 5000));
const store = createStore();
const handler = createFailureHandler();
const worker = createWorker({ store, handler });

let stopping = false;
async function tick() {
  if (stopping) return;
  const result = await worker.tick();
  if (result.processed) console.log(JSON.stringify({ event: "nexus_job_processed", jobId: result.job.jobId, status: result.job.status }));
}

const timer = setInterval(() => { tick().catch((error) => console.error(JSON.stringify({ event: "nexus_worker_error", error: error.message }))); }, intervalMs);

tick().catch((error) => console.error(JSON.stringify({ event: "nexus_worker_error", error: error.message })));

function shutdown(signal) {
  stopping = true;
  clearInterval(timer);
  console.log(JSON.stringify({ event: "nexus_worker_shutdown", signal }));
  process.exit(0);
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

module.exports = { tick, worker, store };
