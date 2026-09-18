"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "github-agent-queue.json");
const MAX_RETRIES = Math.max(1, Math.min(Number(process.env.GITHUB_AGENT_MAX_RETRIES || 3), 5));
const TRANSITIONS = {
  queued: new Set(["diagnosing", "stopped"]),
  diagnosing: new Set(["diagnosed", "queued", "stopped"]),
  diagnosed: new Set(["patching", "queued", "stopped"]),
  patching: new Set(["testing", "queued", "stopped"]),
  testing: new Set(["pr_open", "verified", "queued", "stopped"]),
  pr_open: new Set(["verified", "queued", "stopped"]),
  verified: new Set(),
  stopped: new Set()
};

const LOCK_FILE = `${FILE}.lock`;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 25;
const LOCK_ATTEMPTS = 200;

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}
function read() { ensure(); return JSON.parse(fs.readFileSync(FILE, "utf8")); }
function write(rows) {
  ensure();
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
}
function sleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}
function acquireLock() {
  ensure();
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return fd;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) fs.unlinkSync(LOCK_FILE);
      } catch (staleError) {
        if (staleError.code !== "ENOENT") throw staleError;
      }
      sleep(LOCK_WAIT_MS);
    }
  }
  throw new Error("GitHub agent queue lock timeout");
}
function releaseLock(fd) {
  try { fs.closeSync(fd); } finally {
    try { fs.unlinkSync(LOCK_FILE); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function mutate(mutator) {
  const fd = acquireLock();
  try {
    const rows = read();
    const result = mutator(rows);
    write(rows);
    return result;
  } finally {
    releaseLock(fd);
  }
}
function idFor(payload, deliveryId) {
  if (deliveryId) return `delivery:${String(deliveryId)}`;
  const raw = [payload?.repository?.full_name, payload?.workflow_run?.id, payload?.workflow_run?.run_attempt, payload?.action].join(":");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function normalize(payload, deliveryId) {
  const run = payload?.workflow_run || {};
  return {
    eventId: idFor(payload, deliveryId),
    deliveryId: String(deliveryId || ""),
    action: String(payload?.action || ""),
    repository: String(payload?.repository?.full_name || ""),
    workflow: String(run?.name || ""),
    runId: Number(run?.id || 0),
    runAttempt: Number(run?.run_attempt || 1),
    branch: String(run?.head_branch || ""),
    headSha: String(run?.head_sha || ""),
    conclusion: String(run?.conclusion || ""),
    status: String(run?.status || ""),
    url: String(run?.html_url || ""),
    receivedAt: new Date().toISOString()
  };
}
function ingestWorkflowRun(payload, deliveryId) {
  const job = normalize(payload, deliveryId);
  if (!job.repository || !job.runId) throw new Error("Invalid workflow_run payload");
  if (job.action !== "completed" || job.conclusion !== "failure") return { accepted: false, reason: "not_a_failed_completed_run", job };

  return mutate(rows => {
    const existing = rows.find(x =>
      x.eventId === job.eventId ||
      (job.runId && x.runId === job.runId && x.runAttempt === job.runAttempt && x.action === job.action)
    );
    if (existing) return { accepted: false, duplicate: true, job: existing };

    const repairJob = job.branch.startsWith("repair/")
      ? rows.find(x =>
          x.repository === job.repository &&
          x.branch === job.branch &&
          x.state !== "stopped"
        )
      : null;

    if (repairJob) {
      repairJob.retries = Number(repairJob.retries || 0) + 1;
      repairJob.repairFailures = Number(repairJob.repairFailures || 0) + 1;
      repairJob.lastError = `repair PR CI failed: ${job.workflow} (#${job.runId})`;
      repairJob.lastRepairFailure = job;
      repairJob.updatedAt = new Date().toISOString();
      repairJob.state = repairJob.retries > repairJob.maxRetries ? "stopped" : "queued";

      return {
        accepted: false,
        repairFailure: true,
        job: repairJob
      };
    }

    const item = {
      id: crypto.randomUUID(),
      type: "github_ci_failure",
      state: "queued",
      retries: 0,
      maxRetries: MAX_RETRIES,
      ...job
    };
    rows.push(item);
    return { accepted: true, job: item };
  });
}
function list(limit = 50) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 50, 200))).reverse();
}
function claim() {
  return mutate(rows => {
    const item = rows.find(x => x.state === "queued");
    if (!item) return null;
    item.state = "diagnosing";
    item.claimedAt = new Date().toISOString();
    return item;
  });
}
function transition(id, state, patch = {}) {
  return mutate(rows => {
    const index = rows.findIndex(x => x.id === id);
    if (index < 0) throw new Error("GitHub agent job not found");
    const current = String(rows[index].state || "queued");
    if (!TRANSITIONS[current]?.has(state)) throw new Error(`Invalid state transition: ${current} -> ${state}`);
    rows[index] = { ...rows[index], ...patch, state, updatedAt: new Date().toISOString() };
    return rows[index];
  });
}
function retry(id, reason) {
  return mutate(rows => {
    const index = rows.findIndex(x => x.id === id);
    if (index < 0) throw new Error("GitHub agent job not found");
    const item = rows[index];
    item.retries = Number(item.retries || 0) + 1;
    item.state = item.retries > item.maxRetries ? "stopped" : "queued";
    item.lastError = String(reason || "unknown");
    item.updatedAt = new Date().toISOString();
    return item;
  });
}
module.exports = { ingestWorkflowRun, list, claim, transition, retry, MAX_RETRIES, TRANSITIONS };
