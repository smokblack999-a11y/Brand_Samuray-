"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "recovery-jobs.json");
const LOCK = `${FILE}.lock`;
const LOCK_TTL_MS = 30000;

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}

function withLock(fn) {
  ensure();
  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(LOCK, "wx");
      try {
        return fn();
      } finally {
        fs.closeSync(fd);
        fs.rmSync(LOCK, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(LOCK);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) fs.rmSync(LOCK, { force: true });
      } catch {}
      if (Date.now() - started > LOCK_TTL_MS) throw new Error("RECOVERY_STORE_LOCK_TIMEOUT");
    }
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function write(rows) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
}

function enqueue(job) {
  if (!job?.eventKey) throw new Error("eventKey обязателен");
  return withLock(() => {
    const rows = read();
    const existing = rows.find(x => x.eventKey === job.eventKey);
    if (existing) return { created: false, job: existing };

    const id = `recovery-${crypto.createHash("sha256").update(String(job.eventKey)).digest("hex").slice(0, 24)}`;
    const item = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "queued",
      attempts: 0,
      ...job
    };
    rows.push(item);
    write(rows);
    return { created: true, job: item };
  });
}

function update(id, patch) {
  return withLock(() => {
    const rows = read();
    const i = rows.findIndex(x => x.id === id);
    if (i < 0) throw new Error("recovery job not found");
    rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
    write(rows);
    return rows[i];
  });
}

function list(limit = 100) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse();
}

module.exports = { enqueue, update, list };
