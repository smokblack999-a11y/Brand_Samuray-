"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const QUEUE_FILE = process.env.NEXUS_RECOVERY_QUEUE_PATH || path.join(DATA_DIR, "recovery-queue.json");

function ensure() {
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "[]\n", { mode: 0o600 });
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
}

function write(rows) {
  ensure();
  const tmp = `${QUEUE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, QUEUE_FILE);
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function enqueue({ source, deliveryId, payload, workflowRun }) {
  if (!source || !deliveryId || !payload) throw new Error("source, deliveryId and payload are required");
  const rows = read();
  const repository = workflowRun?.repository || null;
  const runId = workflowRun?.id == null ? null : String(workflowRun.id);
  const existing = rows.find(x =>
    (x.deliveryId === deliveryId && x.source === source) ||
    (runId && x.runId === runId && repository && x.repository === repository)
  );
  if (existing) return { created: false, job: existing };

  const now = new Date().toISOString();
  const runId = workflowRun?.id == null ? null : String(workflowRun.id);
  const job = {
    id: `rec_${crypto.randomUUID()}`,
    source,
    deliveryId: String(deliveryId),
    runId,
    repository,
    workflow: workflowRun?.workflow || null,
    conclusion: workflowRun?.conclusion || null,
    headBranch: workflowRun?.headBranch || null,
    headSha: workflowRun?.headSha || null,
    status: "queued",
    attempts: 0,
    payloadSha256: hashPayload(payload),
    createdAt: now,
    updatedAt: now
  };
  rows.push(job);
  write(rows);
  return { created: true, job };
}

function get(id) {
  return read().find(x => x.id === id) || null;
}

function list(limit = 50) {
  const n = Math.max(1, Math.min(Number(limit) || 50, 200));
  return read().slice(-n).reverse();
}

function update(id, patch) {
  const rows = read();
  const i = rows.findIndex(x => x.id === id);
  if (i < 0) return null;
  rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
  write(rows);
  return rows[i];
}

function stats() {
  const rows = read();
  const byStatus = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  return { total: rows.length, byStatus };
}

module.exports = { enqueue, get, list, update, stats, hashPayload, QUEUE_FILE };
