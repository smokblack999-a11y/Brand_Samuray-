"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const QUEUE_DIR = path.join(DATA_DIR, "queue");
const MAX_ATTEMPTS = Math.max(1, Number(process.env.QUEUE_MAX_ATTEMPTS || 5));
const BACKOFF_BASE_MS = Math.max(1000, Number(process.env.QUEUE_BACKOFF_BASE_MS || 30_000));

function ensure() { fs.mkdirSync(QUEUE_DIR, { recursive: true }); }
function atomicWrite(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function enqueue(type, payload) {
  ensure();
  const id = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const job = { id, type, payload, attempts: 0, status: "pending", createdAt: new Date().toISOString(), nextAttemptAt: Date.now() };
  atomicWrite(path.join(QUEUE_DIR, `${id}.json`), job);
  return job;
}
function list() {
  ensure();
  return fs.readdirSync(QUEUE_DIR).filter(x => x.endsWith(".json")).map(name => {
    try { return JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, name), "utf8")); } catch { return null; }
  }).filter(Boolean).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}
function claim() {
  const jobs = list().filter(j => j.status === "pending" && j.nextAttemptAt <= Date.now());
  const job = jobs[0];
  if (!job) return null;
  job.status = "processing";
  job.attempts += 1;
  job.lockedAt = new Date().toISOString();
  atomicWrite(path.join(QUEUE_DIR, `${job.id}.json`), job);
  return job;
}
function complete(job) {
  const file = path.join(QUEUE_DIR, `${job.id}.json`);
  try { fs.unlinkSync(file); } catch {}
}
function fail(job, error) {
  const file = path.join(QUEUE_DIR, `${job.id}.json`);
  if (job.attempts >= MAX_ATTEMPTS) {
    job.status = "dead";
  } else {
    job.status = "pending";
    job.nextAttemptAt = Date.now() + BACKOFF_BASE_MS * (2 ** (job.attempts - 1));
  }
  job.lastError = String(error?.message || error).slice(0, 1000);
  job.updatedAt = new Date().toISOString();
  atomicWrite(file, job);
}
function recoverStale(maxAgeMs = 120_000) {
  for (const job of list().filter(j => j.status === "processing" && Date.now() - Date.parse(j.lockedAt || 0) > maxAgeMs)) {
    job.status = "pending";
    job.nextAttemptAt = Date.now();
    job.lastError = "Recovered stale processing job";
    atomicWrite(path.join(QUEUE_DIR, `${job.id}.json`), job);
  }
}
function stats() {
  const jobs = list();
  return { total: jobs.length, pending: jobs.filter(j=>j.status==="pending").length, processing: jobs.filter(j=>j.status==="processing").length, dead: jobs.filter(j=>j.status==="dead").length };
}
module.exports = { enqueue, claim, complete, fail, recoverStale, stats };
