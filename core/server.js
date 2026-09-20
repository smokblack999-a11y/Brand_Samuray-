"use strict";
require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReply, checkOpenAI } = require("./openai");
const { sendBusinessMessage } = require("./business-bot");
const { saveLead, claimEvent, updateLead, listLeads, stats } = require("./store");
const { createRateLimiter } = require("./rate-limit");
const { createPersistentQueue } = require("./autonomy/persistent-queue");
const { createWorkflowRunIngress } = require("./github-workflow-run");
const { createX29QueueWorker } = require("./autonomy/x29-queue-worker");
const { createX28Adapter } = require("./architect-x28-adapter");
const { createGithubRestClient } = require("./adapters/github-rest");
const { createX29Runtime } = require("./x29-runtime");
const { createHttpRepairCandidateProvider } = require("./adapters/repair-candidate-http");
const { createOpenAIRepairCandidateProvider } = require("./adapters/openai-repair-candidate");
const { createLiveGithubPrAdapter } = require("./adapters/github-pr-live-adapter");
const { createGithubSandboxAdapter } = require("./adapters/github-sandbox-adapter");
const { createLiveGithubCiVerifier } = require("./adapters/github-live-ci");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));
const LEAD_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 60000));
const LEAD_RATE_LIMIT_MAX = Math.max(1, Number(process.env.LEAD_RATE_LIMIT_MAX || 20));
const GITHUB_WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || "").trim();
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || "").trim();
const GITHUB_OWNER = String(process.env.GITHUB_OWNER || "").trim();
const GITHUB_REPO = String(process.env.GITHUB_REPO || "").trim();
const REPAIR_CANDIDATE_URL = String(process.env.REPAIR_CANDIDATE_URL || "").trim();
const REPAIR_CONTEXT_PATHS = String(process.env.REPAIR_CONTEXT_PATHS || "").split(",").map(value => value.trim()).filter(Boolean);
const githubLive = GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO
  ? createGithubRestClient({ token: GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO })
  : null;
const REPAIR_QUEUE_FILE = String(process.env.REPAIR_QUEUE_FILE || "./data/repair-queue.json").trim();

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!API_KEY) missing.push("CORE_API_KEY");
  if (!WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (missing.length) throw new Error(`Production startup blocked: missing ${missing.join(", ")}`);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
app.use(express.json({ limit: "256kb", verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));

function errorBody(code, message, requestId) {
  return { ok: false, error: { code, message, requestId } };
}

function safeEqual(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(503).json(errorBody("AUTH_NOT_CONFIGURED", "API authentication is not configured", req.requestId));
  if (safeEqual(API_KEY, req.get("X-API-Key"))) return next();
  return res.status(401).json(errorBody("UNAUTHORIZED", "Unauthorized", req.requestId));
}
function requireWebhookSecret(req, res, next) {
  if (!WEBHOOK_SECRET) return res.status(503).json(errorBody("WEBHOOK_AUTH_NOT_CONFIGURED", "Webhook authentication is not configured", req.requestId));
  if (safeEqual(WEBHOOK_SECRET, req.get("X-Telegram-Bot-Api-Secret-Token"))) return next();
  return res.status(401).json(errorBody("UNAUTHORIZED_WEBHOOK", "Unauthorized webhook", req.requestId));
}
function requestId(req, res, next) {
  const id = crypto.randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

app.use(requestId);
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json(errorBody("REQUEST_TIMEOUT", "Request timed out", req.requestId));
  }, REQUEST_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer));
  next();
});

const leadRateLimit = createRateLimiter({ windowMs: LEAD_RATE_LIMIT_WINDOW_MS, max: LEAD_RATE_LIMIT_MAX });
const repairQueue = createPersistentQueue(REPAIR_QUEUE_FILE);
const x28Adapter = createX28Adapter({
  existingJobKeys: new Set(),
  policy: { maxAttempts: 2, maxChangedFiles: 8, maxChangedLines: 400, blockedPaths: [".env"] }
});
const candidateProvider = REPAIR_CANDIDATE_URL
  ? createHttpRepairCandidateProvider({ url: REPAIR_CANDIDATE_URL })
  : process.env.OPENAI_API_KEY
    ? createOpenAIRepairCandidateProvider()
    : null;

const x29Runtime = githubLive && candidateProvider
  ? createX29Runtime({
      queue: repairQueue,
      x28Adapter,
      candidateProvider,
      sandbox: createGithubSandboxAdapter({ github: githubLive }),
      pullRequest: createLiveGithubPrAdapter({ github: githubLive }),
      ciVerifier: createLiveGithubCiVerifier({ github: githubLive }),
      maxAttempts: 2
    })
  : null;

let repairWorkerBusy = false;
let repairWorkerTimer = null;
const repairWorker = GITHUB_WEBHOOK_SECRET
  ? createX29QueueWorker({
      queue: repairQueue,
      handler: async item => {
        const workflowRun = item.workflow_run || item.eventPayload || item;
        const contextRef = workflowRun?.head_branch || workflowRun?.repository?.default_branch || "main";
        const modifiedPaths = Array.isArray(workflowRun?.head_commit?.modified)
          ? workflowRun.head_commit.modified
          : [];
        const configuredPaths = REPAIR_CONTEXT_PATHS;
        const contextPaths = [...new Set([...modifiedPaths, ...configuredPaths])]
          .filter(path => path && path !== ".env" && !path.startsWith(".github/workflows/"))
          .slice(0, 8);
        const sourceContext = githubLive
          ? (await Promise.all(contextPaths.map(async path => {
              try { return await githubLive.getFile({ path, ref: contextRef }); }
              catch (error) { return { path, error: error.message }; }
            }))).filter(Boolean)
          : [];
        const mission = {
          id: item.id,
          type: "ci-repair",
          input: { workflowRun, sourceContext }
        };
        if (!x29Runtime) {
          return {
            status: "escalated",
            reason: githubLive ? "REPAIR_CANDIDATE_URL_NOT_CONFIGURED" : "GITHUB_LIVE_ADAPTER_NOT_CONFIGURED"
          };
        }
        const result = await x29Runtime.run(mission);
        return result;
      },
      maxAttempts: 2
    })
  : null;
async function processRepairQueue() {
  if (!repairWorker || repairWorkerBusy) return;
  repairWorkerBusy = true;
  try { await repairWorker.processOnce(); }
  catch (error) { console.error(JSON.stringify({ event: "x29_worker_failed", error: error.message })); }
  finally {
    repairWorkerBusy = false;
    repairWorkerTimer = setTimeout(processRepairQueue, 250);
    repairWorkerTimer.unref?.();
  }
}

if (repairWorker) processRepairQueue();

const githubIngress = GITHUB_WEBHOOK_SECRET
  ? createWorkflowRunIngress({ queue: repairQueue, secret: GITHUB_WEBHOOK_SECRET })
  : null;

app.post("/api/github/webhook", async (req, res) => {
  if (!githubIngress) return res.status(503).json(errorBody("GITHUB_WEBHOOK_NOT_CONFIGURED", "GitHub webhook is not configured", req.requestId));
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const payload = req.body;

  const result = githubIngress.accept({
    rawBody,
    signature: req.get("X-Hub-Signature-256"),
    eventName: req.get("X-GitHub-Event"),
    payload
  });
  if (!result.accepted) return res.status(401).json(errorBody("INVALID_GITHUB_WEBHOOK", result.reason, req.requestId));
  if (result.queued) processRepairQueue();
  return res.status(202).json({ ok: true, accepted: true, result, requestId: req.requestId });
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.7.0" }));
app.get("/ready", (req, res) => {
  try {
    const current = stats();
    const ready = Boolean(API_KEY && WEBHOOK_SECRET && current && Number.isFinite(current.total));
    return res.status(ready ? 200 : 503).json({ ok: ready, service: "SamuraiOS Core", ready, requestId: req.requestId });
  } catch (_error) {
    return res.status(503).json(errorBody("NOT_READY", "Service is not ready", req.requestId));
  }
});
app.get("/health/openai", requireApiKey, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json(errorBody("OPENAI_NOT_CONFIGURED", "OpenAI is not configured", req.requestId));
  try {
    await checkOpenAI();
    return res.json({ ok: true, service: "openai", configured: true, requestId: req.requestId });
  } catch (error) {
    console.error(JSON.stringify({ event: "openai_health_failed", requestId: req.requestId, error: error.message }));
    return res.status(503).json(errorBody("OPENAI_UNAVAILABLE", "OpenAI service is unavailable", req.requestId));
  }
});
app.get("/api/leads", requireApiKey, (req, res) => res.json({ ok: true, leads: listLeads(req.query.limit), requestId: req.requestId }));
app.get("/api/stats", requireApiKey, (req, res) => res.json({ ok: true, stats: stats(), requestId: req.requestId }));

async function analyze(message, business) {
  const text = String(message || "").trim();
  if (!text) {
    const error = new Error("message обязателен");
    error.code = "INVALID_MESSAGE";
    throw error;
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    const error = new Error(`message слишком длинный (максимум ${MAX_MESSAGE_CHARS} символов)`);
    error.code = "MESSAGE_TOO_LONG";
    throw error;
  }
  const lead = scoreLead(text);
  const reply = process.env.OPENAI_API_KEY ? await generateReply({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead }) : null;
  return { lead, reply };
}

app.post("/api/lead/analyze", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const { message, business } = req.body || {};
    const result = await analyze(message, business);
    const saved = saveLead({ source: "api", message: String(message).trim(), ...result.lead, reply: result.reply });
    res.json({ ok: true, ...result, saved, requestId: req.requestId });
  } catch (error) {
    console.error(JSON.stringify({ event: "lead_analyze_failed", requestId: req.requestId, code: error.code || "INTERNAL_ERROR", error: error.message }));
    const upstream = /authentication|rate limit|temporarily unavailable|timed out/i.test(error.message);
    const status = error.code === "INVALID_MESSAGE" || error.code === "MESSAGE_TOO_LONG" ? 400 : upstream ? 503 : 500;
    const code = error.code || (upstream ? "UPSTREAM_UNAVAILABLE" : "INTERNAL_ERROR");
    const message = status === 500 ? "Internal server error" : status === 503 ? "Upstream service unavailable" : error.message;
    res.status(status).json(errorBody(code, message, req.requestId));
  }
});

app.post("/api/telegram/webhook", requireWebhookSecret, async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body || {};
    if (update.business_connection) {
      console.log(JSON.stringify({ event: "business_connection", id: update.business_connection.id, requestId: req.requestId }));
      return;
    }
    const message = update.business_message;
    if (!message?.text || !message.business_connection_id || !message.chat?.id || !Number.isInteger(message.message_id)) return;
    const eventKey = `telegram:${message.business_connection_id}:${message.chat.id}:${message.message_id}`;
    const claim = claimEvent(eventKey, { source: "telegram_business", businessConnectionId: message.business_connection_id, chatId: message.chat.id, messageId: message.message_id, customer: message.from?.id || null, message: message.text });
    if (!claim.claimed) {
      console.log(JSON.stringify({ event: "duplicate_telegram_event", eventKey, requestId: req.requestId }));
      return;
    }
    try {
      const result = await analyze(message.text, process.env.BUSINESS_NAME);
      const saved = updateLead(claim.item.id, { ...result.lead, reply: result.reply, status: "completed" });
      console.log(JSON.stringify({ event: "lead", id: saved.id, chatId: message.chat.id, score: result.lead.score, intent: result.lead.intent, requestId: req.requestId }));
      if (result.reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") await sendBusinessMessage({ businessConnectionId: message.business_connection_id, chatId: message.chat.id, text: result.reply });
    } catch (error) {
      updateLead(claim.item.id, { status: "failed", error: error.message });
      throw error;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "business_webhook_error", requestId: req.requestId, error: error.message }));
  }
});

app.use((req, res) => res.status(404).json(errorBody("NOT_FOUND", "Endpoint not found", req.requestId)));

const server = app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 2.7.0 listening on :${PORT}`));
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;

function shutdown(signal) {
  console.log(JSON.stringify({ event: "shutdown", signal }));
  if (repairWorkerTimer) clearTimeout(repairWorkerTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, analyze };
