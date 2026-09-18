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

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}
function read() { ensure(); return JSON.parse(fs.readFileSync(FILE, "utf8")); }
function write(rows) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
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
  const rows = read();
  const existing = rows.find(x => x.eventId === job.eventId || (job.runId && x.runId === job.runId && x.runAttempt === job.runAttempt && x.action === job.action));
  if (existing) return { accepted: false, duplicate: true, job: existing };
  const item = { id: crypto.randomUUID(), type: "github_ci_failure", state: "queued", retries: 0, maxRetries: MAX_RETRIES, ...job };
  rows.push(item);
  write(rows);
  return { accepted: true, job: item };
}
function list(limit = 50) { return read().slice(-Math.max(1, Math.min(Number(limit) || 50, 200))).reverse(); }
function claim() {
  const rows = read();
  const item = rows.find(x => x.state === "queued");
  if (!item) return null;
  item.state = "diagnosing";
  item.claimedAt = new Date().toISOString();
  write(rows);
  return item;
}
function transition(id, state, patch = {}) {
  const rows = read();
  const index = rows.findIndex(x => x.id === id);
  if (index < 0) throw new Error("GitHub agent job not found");
  const current = String(rows[index].state || "queued");
  if (!TRANSITIONS[current]?.has(state)) throw new Error(`Invalid state transition: ${current} -> ${state}`);
  rows[index] = { ...rows[index], ...patch, state, updatedAt: new Date().toISOString() };
  write(rows);
  return rows[index];
}
function retry(id, reason) {
  const rows = read();
  const index = rows.findIndex(x => x.id === id);
  if (index < 0) throw new Error("GitHub agent job not found");
  const item = rows[index];
  item.retries = Number(item.retries || 0) + 1;
  item.state = item.retries > item.maxRetries ? "stopped" : "queued";
  item.lastError = String(reason || "unknown");
  item.updatedAt = new Date().toISOString();
  write(rows);
  return item;
}
module.exports = { ingestWorkflowRun, list, claim, transition, retry, MAX_RETRIES, TRANSITIONS };
