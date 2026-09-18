"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fingerprint, decide } = require("./kill-critic");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const QUEUE_FILE = path.join(DATA_DIR, "recovery-queue.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "[]\n");
}
function read() {
  ensure();
  return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
}
function write(rows) {
  ensure();
  const tmp = QUEUE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, QUEUE_FILE);
}
function stableId(event) {
  const run = event?.workflow_run || {};
  return String(run.id || crypto.createHash("sha256").update(JSON.stringify(event || {})).digest("hex"));
}
function extractFailure(event) {
  const run = event?.workflow_run || {};
  return {
    workflow: run.name,
    job: run.id,
    step: run.head_branch,
    exitCode: run.conclusion === "success" ? 0 : 1,
    errorType: run.conclusion || "unknown",
    errorMessage: run.display_title || run.name || "GitHub workflow completed",
    command: run.html_url || ""
  };
}
function enqueueWorkflow(event) {
  const key = "github:" + stableId(event);
  const rows = read();
  const existing = rows.find(x => x.eventKey === key);
  if (existing) return { created: false, item: existing };

  const failure = extractFailure(event);
  const item = {
    id: crypto.randomUUID(),
    eventKey: key,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: failure.errorType === "success" ? "completed" : "queued",
    attempts: 0,
    fingerprint: fingerprint(failure),
    failure
  };

  if (failure.errorType !== "success") {
    item.critic = decide({
      attempts: 0,
      evidence: {
        exactErrorMatch: 0,
        stackTraceMatch: 0,
        changedFileMatch: 0,
        dependencyMatch: 0,
        historicalMatch: 0,
        scopeMatch: 1,
        sandboxPass: false,
        regressionPass: false
      },
      patch: { changedFiles: 0, changedLines: 0 }
    });
    item.status = item.critic.action === "STOP" ? "blocked" : "queued";
  }

  rows.push(item);
  write(rows);
  return { created: true, item };
}
function listRecovery(limit = 50) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 50, 500))).reverse();
}
module.exports = { enqueueWorkflow, listRecovery };
