"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "interop-jobs.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}
function read() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function write(rows) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function enqueue(job, eventKey) {
  if (!eventKey) throw new Error("eventKey is required");
  const rows = read();
  const existing = rows.find(row => row.eventKey === eventKey);
  if (existing) return { enqueued: false, job: existing };
  const item = {
    ...job,
    id: job.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventKey,
    createdAt: job.createdAt || new Date().toISOString()
  };
  rows.push(item);
  write(rows);
  return { enqueued: true, job: item };
}

function list(limit = 100) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse();
}

function stats() {
  const rows = read();
  return {
    total: rows.length,
    queued: rows.filter(x => x.stage === "QUEUED").length,
    running: rows.filter(x => x.stage === "RUNNING").length,
    diagnosing: rows.filter(x => x.stage === "DIAGNOSING").length,
    verified: rows.filter(x => x.stage === "VERIFIED").length,
    stopped: rows.filter(x => x.stage === "STOPPED").length,
    failed: rows.filter(x => x.conclusion === "failure").length
  };
}

module.exports = { enqueue, list, stats };
