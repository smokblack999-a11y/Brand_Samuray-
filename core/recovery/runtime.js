"use strict";

const crypto = require("crypto");
const queue = require("./queue");

const RECOVERY_API_KEY = String(process.env.X10THINK_RECOVERY_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || "").trim();

function safeEqual(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireApiKey(req) {
  if (!RECOVERY_API_KEY) {
    const error = new Error("Recovery API key is not configured");
    error.code = "RECOVERY_AUTH_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (!safeEqual(RECOVERY_API_KEY, req.get("X-API-Key"))) {
    const error = new Error("Unauthorized");
    error.code = "UNAUTHORIZED";
    error.status = 401;
    throw error;
  }
}

function verifyGithubSignature(req) {
  if (!WEBHOOK_SECRET) {
    const error = new Error("GitHub webhook secret is not configured");
    error.code = "WEBHOOK_AUTH_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  const signature = String(req.get("X-Hub-Signature-256") || "");
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const expected = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")}`;

  if (!safeEqual(expected, signature)) {
    const error = new Error("Invalid GitHub webhook signature");
    error.code = "INVALID_WEBHOOK_SIGNATURE";
    error.status = 401;
    throw error;
  }
}

function workflowRunFromEvent(event) {
  const run = event?.workflow_run || {};
  return {
    id: run.id,
    repository: event?.repository?.full_name || null,
    workflow: run.name || null,
    conclusion: run.conclusion || null,
    headBranch: run.head_branch || null,
    headSha: run.head_sha || null
  };
}

function deliveryIdFrom(req, event) {
  return String(req.get("X-GitHub-Delivery") || event?.workflow_run?.id || "").trim();
}

function accept(req, { source, requireSignature = false }) {
  if (requireSignature) verifyGithubSignature(req);
  else requireApiKey(req);

  const event = req.body || {};
  const deliveryId = deliveryIdFrom(req, event);
  if (!deliveryId) {
    const error = new Error("GitHub delivery id or workflow_run.id is required");
    error.code = "DELIVERY_ID_REQUIRED";
    error.status = 400;
    throw error;
  }

  const result = queue.enqueue({
    source,
    deliveryId,
    payload: JSON.stringify(event),
    workflowRun: workflowRunFromEvent(event)
  });

  return {
    ok: true,
    created: result.created,
    job: result.job
  };
}

function health() {
  return {
    ok: true,
    service: "NEXUS Recovery Runtime",
    version: "1.0.0",
    auth: {
      apiKeyConfigured: Boolean(RECOVERY_API_KEY),
      githubWebhookConfigured: Boolean(WEBHOOK_SECRET)
    },
    queue: {
      path: queue.QUEUE_FILE,
      ...queue.stats()
    }
  };
}

module.exports = {
  accept,
  health,
  getJob: queue.get,
  listJobs: queue.list,
  updateJob: queue.update,
  queueStats: queue.stats,
  verifyGithubSignature
};
