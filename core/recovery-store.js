"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "recovery-jobs.json");

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
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
}
function enqueue(job) {
  if (!job?.eventKey) throw new Error("eventKey обязателен");
  const rows = read();
  const existing = rows.find(x => x.eventKey === job.eventKey);
  if (existing) return { created: false, job: existing };
  const item = {
    id: `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "queued",
    attempts: 0,
    ...job
  };
  rows.push(item);
  write(rows);
  return { created: true, job: item };
}
function update(id, patch) {
  const rows = read();
  const i = rows.findIndex(x => x.id === id);
  if (i < 0) throw new Error("recovery job not found");
  rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
  write(rows);
  return rows[i];
}
function list(limit = 100) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse();
}
module.exports = { enqueue, update, list };
