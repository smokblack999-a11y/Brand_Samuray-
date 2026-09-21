"use strict";

const { processJob } = require("./worker");
const recovery = require("./index");

function createRecoveryScheduler(options = {}) {
  const intervalMs = Math.max(250, Number(options.intervalMs || 1000));
  const concurrency = Math.max(1, Number(options.concurrency || 1));
  const executor = options.executor;
  if (typeof executor !== "function") throw new Error("recovery scheduler requires an executor function");

  const active = new Set();
  let timer = null;
  let stopped = false;

  async function drain() {
    if (stopped) return;
    const capacity = Math.max(0, concurrency - active.size);
    if (!capacity) return;

    const jobs = recovery.listJobs(500).filter(job =>
      (job.status === "queued" || job.status === "retryable") &&
      !active.has(job.id) &&
      Number(job.attempts || 0) < Number(job.budget?.maxAttempts || 3)
    );

    for (const job of jobs.slice(0, capacity)) {
      active.add(job.id);
      processJob(job.id, executor, options)
        .catch(() => null)
        .finally(() => active.delete(job.id));
    }
  }

  function start() {
    if (timer || stopped) return;
    stopped = false;
    timer = setInterval(drain, intervalMs);
    void drain();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function status() {
    return { running: !stopped && Boolean(timer), activeJobs: [...active], concurrency, intervalMs };
  }

  return { start, stop, drain, status };
}

module.exports = { createRecoveryScheduler };
