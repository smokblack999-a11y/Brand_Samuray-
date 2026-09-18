"use strict";

/**
 * Durable JSON-backed queue for the X29 worker boundary.
 *
 * It provides crash/restart persistence and event-key deduplication.
 * It does not execute arbitrary commands and does not talk to GitHub.
 */

const fs = require("fs");
const path = require("path");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createPersistentQueue(filePath) {
  if (!filePath) throw new TypeError("filePath is required");
  const absolute = path.resolve(filePath);

  function ensure() {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, "{\"jobs\":[]}\n");
  }

  function read() {
    ensure();
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  }

  function write(state) {
    ensure();
    const tmp = `${absolute}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    fs.renameSync(tmp, absolute);
  }

  return Object.freeze({
    enqueue(job) {
      if (!job?.id) throw new TypeError("job.id is required");
      const state = read();
      const existing = state.jobs.find(x => x.id === job.id);
      if (existing) return { claimed: false, job: clone(existing) };
      const item = {
        ...clone(job),
        queueStatus: "queued",
        queuedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.jobs.push(item);
      write(state);
      return { claimed: true, job: clone(item) };
    },

    claimNext() {
      const state = read();
      const index = state.jobs.findIndex(x => x.queueStatus === "queued");
      if (index < 0) return null;
      state.jobs[index].queueStatus = "processing";
      state.jobs[index].updatedAt = new Date().toISOString();
      write(state);
      return clone(state.jobs[index]);
    },

    complete(id, result) {
      const state = read();
      const index = state.jobs.findIndex(x => x.id === id);
      if (index < 0) throw new Error("job not found");
      state.jobs[index] = {
        ...state.jobs[index],
        queueStatus: "completed",
        result: clone(result),
        updatedAt: new Date().toISOString()
      };
      write(state);
      return clone(state.jobs[index]);
    },

    fail(id, error, { retry = false } = {}) {
      const state = read();
      const index = state.jobs.findIndex(x => x.id === id);
      if (index < 0) throw new Error("job not found");
      state.jobs[index] = {
        ...state.jobs[index],
        queueStatus: retry ? "queued" : "failed",
        lastError: { name: error?.name || "Error", message: error?.message || String(error) },
        updatedAt: new Date().toISOString()
      };
      write(state);
      return clone(state.jobs[index]);
    },

    list() {
      return clone(read().jobs);
    }
  });
}

module.exports = { createPersistentQueue };
