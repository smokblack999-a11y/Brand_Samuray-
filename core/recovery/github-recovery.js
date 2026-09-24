"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const EVENT_FILE = path.join(DATA_DIR, "recovery-events.json");

const BLOCKED_ACTIONS = [
  "rm -rf",
  "curl | sh",
  "wget | sh",
  "drop database",
  "disable authentication",
  "skip verification",
  "auto merge",
];

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EVENT_FILE)) fs.writeFileSync(EVENT_FILE, "[]\n");
}

function readEvents() {
  ensureStore();
  return JSON.parse(fs.readFileSync(EVENT_FILE, "utf8"));
}

function writeEvents(rows) {
  ensureStore();
  const tmp = EVENT_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, EVENT_FILE);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyGitHubSignature(rawBody, signature, secret) {
  if (!secret) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return safeEqual(expected, signature);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function classifyRun(run) {
  const conclusion = String(run?.conclusion || "unknown");
  if (conclusion === "success") return { status: "healthy", severity: "none" };
  if (["failure", "startup_failure", "timed_out"].includes(conclusion)) {
    return { status: "failed", severity: "high" };
  }
  if (conclusion === "cancelled") return { status: "cancelled", severity: "medium" };
  return { status: "unknown", severity: "medium" };
}

function buildRca(payload) {
  const run = payload?.workflow_run || {};
  const classification = classifyRun(run);
  const repo = payload?.repository?.full_name || "unknown";
  const sha = run.head_sha || "unknown";
  const runId = String(run.id || "unknown");

  const action =
    classification.status === "failed"
      ? "inspect failed workflow jobs and reproduce the failure before proposing a patch"
      : "record workflow result and continue monitoring";

  return {
    schema: "x10thinc.github.recovery.v1",
    run_id: runId,
    repository: repo,
    workflow: run.name || "unknown",
    conclusion: run.conclusion || "unknown",
    sha,
    branch: run.head_branch || null,
    classification,
    evidence: {
      workflow_run_url: run.html_url || null,
      event: payload?.action || null,
      created_at: run.created_at || null,
      updated_at: run.updated_at || null,
    },
    rca: {
      hypothesis:
        classification.status === "failed"
          ? "CI execution failed; root cause requires failed-job evidence."
          : "No failure RCA required for this workflow result.",
      confidence: classification.status === "failed" ? "low" : "high",
      next_action: action,
    },
    kill_critic: killCritic(action),
  };
}

function killCritic(action) {
  const normalized = String(action || "").toLowerCase();
  const violations = BLOCKED_ACTIONS.filter((rule) => normalized.includes(rule));
  return {
    allowed: violations.length === 0,
    violations,
    action_hash: sha256(action),
  };
}

function ingestWorkflowRun(payload, deliveryId) {
  const run = payload?.workflow_run || {};
  const key = deliveryId || String(run.id || sha256(JSON.stringify(payload)));

  const rows = readEvents();
  const existing = rows.find((x) => x.delivery_id === key);

  if (existing) {
    return { duplicate: true, event: existing };
  }

  const rca = buildRca(payload);
  const event = {
    delivery_id: key,
    received_at: new Date().toISOString(),
    ...rca,
  };

  rows.push(event);
  writeEvents(rows);

  return { duplicate: false, event };
}

function getRecoveryStats() {
  const rows = readEvents();
  return {
    total: rows.length,
    failed: rows.filter((x) => x.classification?.status === "failed").length,
    healthy: rows.filter((x) => x.classification?.status === "healthy").length,
    last: rows.length ? rows[rows.length - 1] : null,
  };
}

module.exports = {
  verifyGitHubSignature,
  ingestWorkflowRun,
  buildRca,
  killCritic,
  getRecoveryStats,
};
