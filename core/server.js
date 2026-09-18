"use strict";
require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReply, checkOpenAI } = require("./openai");
const { runDualAI } = require("./dual-ai");
const { sendBusinessMessage } = require("./business-bot");
const { saveLead, claimEvent, updateLead, listLeads, stats } = require("./store");
const { createRateLimiter } = require("./rate-limit");
const githubAgent = require("./github-agent");
const { processNext: processGitHubDiagnosis } = require("./github-agent-worker");
const { processRepair } = require("./github-agent-repair-worker");
const { verifyNext: verifyGitHubPR } = require("./github-agent-pr-verifier");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const GITHUB_WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || "").trim();
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));
const LEAD_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 60000));
const LEAD_RATE_LIMIT_MAX = Math.max(1, Number(process.env.LEAD_RATE_LIMIT_MAX || 20));

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!API_KEY) missing.push("CORE_API_KEY");
  if (!WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!GITHUB_WEBHOOK_SECRET) missing.push("GITHUB_WEBHOOK_SECRET");
  if (missing.length) throw new Error(`Production startup blocked: missing ${missing.join(", ")}`);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
app.use(express.json({
  limit: "256kb",
  verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); }
}));

function errorBody(code, message, requestId) { return { ok: false, error: { code, message, requestId } }; }
function safeEqual(expected, actual) {
  const a = Buffer.from(String(expected || "")); const b = Buffer.from(String(actual || ""));
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
function requireGitHubWebhook(req, res, next) {
  if (!GITHUB_WEBHOOK_SECRET) return res.status(503).json(errorBody("GITHUB_WEBHOOK_NOT_CONFIGURED", "GitHub webhook authentication is not configured", req.requestId));
  const signature = String(req.get("X-Hub-Signature-256") || "");
  const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from("");
  const expected = `sha256=${crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;
  if (safeEqual(expected, signature)) return next();
  return res.status(401).json(errorBody("UNAUTHORIZED_GITHUB_WEBHOOK", "Unauthorized GitHub webhook", req.requestId));
}
function requestId(req, res, next) { const id = crypto.randomUUID(); req.requestId = id; res.setHeader("X-Request-Id", id); next(); }
app.use(requestId);
app.use((req, res, next) => {
  const timer = setTimeout(() => { if (!res.headersSent) res.status(503).json(errorBody("REQUEST_TIMEOUT", "Request timed out", req.requestId)); }, REQUEST_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer)); next();
});

const leadRateLimit = createRateLimiter({ windowMs: LEAD_RATE_LIMIT_WINDOW_MS, max: LEAD_RATE_LIMIT_MAX });
const dualAIRateLimit = createRateLimiter({ windowMs: Math.max(1000, Number(process.env.DUAL_AI_RATE_LIMIT_WINDOW_MS || 60000)), max: Math.max(1, Number(process.env.DUAL_AI_RATE_LIMIT_MAX || 5)) });

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.9.1-x18-agent" }));
app.get("/ready", (req, res) => {
  try { const current = stats(); const ready = Boolean(API_KEY && WEBHOOK_SECRET && GITHUB_WEBHOOK_SECRET && current && Number.isFinite(current.total)); return res.status(ready ? 200 : 503).json({ ok: ready, service: "SamuraiOS Core", ready, requestId: req.requestId }); }
  catch (_error) { return res.status(503).json(errorBody("NOT_READY", "Service is not ready", req.requestId)); }
});
app.get("/health/openai", requireApiKey, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json(errorBody("OPENAI_NOT_CONFIGURED", "OpenAI is not configured", req.requestId));
  try { await checkOpenAI(); return res.json({ ok: true, service: "openai", configured: true, requestId: req.requestId }); }
  catch (error) { console.error(JSON.stringify({ event: "openai_health_failed", requestId: req.requestId, error: error.message })); return res.status(503).json(errorBody("OPENAI_UNAVAILABLE", "OpenAI service is unavailable", req.requestId)); }
});
app.get("/api/leads", requireApiKey, (req, res) => res.json({ ok: true, leads: listLeads(req.query.limit), requestId: req.requestId }));
app.get("/api/stats", requireApiKey, (req, res) => res.json({ ok: true, stats: stats(), requestId: req.requestId }));
app.get("/api/github/queue", requireApiKey, (req, res) => res.json({ ok: true, jobs: githubAgent.list(req.query.limit), requestId: req.requestId }));

app.post("/api/github/webhook", requireGitHubWebhook, (req, res) => {
  const event = String(req.get("X-GitHub-Event") || "");
  const deliveryId = String(req.get("X-GitHub-Delivery") || "");
  try {
    if (event !== "workflow_run") return res.status(202).json({ ok: true, accepted: false, reason: "event_not_supported", event, requestId: req.requestId });
    const result = githubAgent.ingestWorkflowRun(req.body || {}, deliveryId);
    return res.status(202).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    console.error(JSON.stringify({ event: "github_webhook_failed", requestId: req.requestId, error: error.message }));
    return res.status(400).json(errorBody("INVALID_GITHUB_EVENT", error.message, req.requestId));
  }
});

app.post("/api/github/worker/diagnose", requireApiKey, async (req, res) => {
  try {
    const result = await processGitHubDiagnosis();
    return res.status(result.processed ? 200 : 204).json(result);
  } catch (error) {
    console.error(JSON.stringify({ event: "github_diagnosis_failed", requestId: req.requestId, error: error.message }));
    return res.status(503).json(errorBody("GITHUB_DIAGNOSIS_FAILED", "GitHub diagnosis failed", req.requestId));
  }
});

app.post("/api/github/worker/repair", requireApiKey, async (req, res) => {
  try {
    const result = await processRepair();
    return res.status(result.processed ? 200 : 204).json(result);
  } catch (error) {
    console.error(JSON.stringify({ event: "github_repair_failed", requestId: req.requestId, error: error.message }));
    return res.status(503).json(errorBody("GITHUB_REPAIR_FAILED", "GitHub repair failed", req.requestId));
  }
});

app.post("/api/github/worker/verify", requireApiKey, async (req, res) => {
  try {
    const result = await verifyGitHubPR();
    return res.status(result.processed ? 200 : 204).json(result);
  } catch (error) {
    console.error(JSON.stringify({ event: "github_verification_failed", requestId: req.requestId, error: error.message }));
    return res.status(503).json(errorBody("GITHUB_VERIFICATION_FAILED", "GitHub verification failed", req.requestId));
  }
});

app.post("/api/github/queue/claim", requireApiKey, (req, res) => {
  const job = githubAgent.claim();
  return res.json({ ok: true, job, requestId: req.requestId });
});
app.post("/api/github/queue/:id/retry", requireApiKey, (req, res) => {
  try { return res.json({ ok: true, job: githubAgent.retry(req.params.id, req.body?.reason), requestId: req.requestId }); }
  catch (error) { return res.status(404).json(errorBody("JOB_NOT_FOUND", error.message, req.requestId)); }
});
app.post("/api/github/queue/:id/state", requireApiKey, (req, res) => {
  try {
    const allowed = new Set(["queued", "diagnosing", "diagnosed", "patching", "testing", "pr_open", "verified", "stopped"]);
    const state = String(req.body?.state || "");
    if (!allowed.has(state)) return res.status(400).json(errorBody("INVALID_STATE", "Invalid agent state", req.requestId));
    return res.json({ ok: true, job: githubAgent.transition(req.params.id, state, req.body?.patch || {}), requestId: req.requestId });
  } catch (error) { return res.status(404).json(errorBody("JOB_NOT_FOUND", error.message, req.requestId)); }
});

async function analyze(message, business) {
  const text = String(message || "").trim();
  if (!text) { const error = new Error("message обязателен"); error.code = "INVALID_MESSAGE"; throw error; }
  if (text.length > MAX_MESSAGE_CHARS) { const error = new Error(`message слишком длинный (максимум ${MAX_MESSAGE_CHARS} символов)`); error.code = "MESSAGE_TOO_LONG"; throw error; }
  const lead = scoreLead(text);
  const reply = process.env.OPENAI_API_KEY ? await generateReply({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead }) : null;
  return { lead, reply };
}
app.post("/api/dual-ai/run", requireApiKey, dualAIRateLimit, async (req, res) => {
  try {
    const task = String(req.body?.task || "").trim();
    if (!task) return res.status(400).json(errorBody("INVALID_TASK", "task обязателен", req.requestId));
    if (task.length > MAX_MESSAGE_CHARS) return res.status(400).json(errorBody("TASK_TOO_LONG", `task слишком длинный (максимум ${MAX_MESSAGE_CHARS} символов)`, req.requestId));
    if (!process.env.OPENAI_API_KEY) return res.status(503).json(errorBody("OPENAI_NOT_CONFIGURED", "OpenAI is not configured", req.requestId));
    const result = await runDualAI(task, { maxRounds: req.body?.maxRounds });
    return res.json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) { console.error(JSON.stringify({ event: "dual_ai_failed", requestId: req.requestId, error: error.message })); return res.status(503).json(errorBody("DUAL_AI_FAILED", "Dual AI unavailable", req.requestId)); }
});
app.post("/api/lead/analyze", requireApiKey, leadRateLimit, async (req, res) => {
  try { const { message, business } = req.body || {}; const result = await analyze(message, business); const saved = saveLead({ source: "api", message: String(message).trim(), ...result.lead, reply: result.reply }); res.json({ ok: true, ...result, saved, requestId: req.requestId }); }
  catch (error) { console.error(JSON.stringify({ event: "lead_analyze_failed", requestId: req.requestId, code: error.code || "INTERNAL_ERROR", error: error.message })); const upstream = /authentication|rate limit|temporarily unavailable|timed out/i.test(error.message); const status = error.code === "INVALID_MESSAGE" || error.code === "MESSAGE_TOO_LONG" ? 400 : upstream ? 503 : 500; const code = error.code || (upstream ? "UPSTREAM_UNAVAILABLE" : "INTERNAL_ERROR"); const message = status === 500 ? "Internal server error" : status === 503 ? "Upstream service unavailable" : error.message; res.status(status).json(errorBody(code, message, req.requestId)); }
});
app.post("/api/telegram/webhook", requireWebhookSecret, async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body || {};
    if (update.business_connection) return console.log(JSON.stringify({ event: "business_connection", id: update.business_connection.id, requestId: req.requestId }));
    const message = update.business_message;
    if (!message?.text || !message.business_connection_id || !message.chat?.id || !Number.isInteger(message.message_id)) return;
    const eventKey = `telegram:${message.business_connection_id}:${message.chat.id}:${message.message_id}`;
    const claim = claimEvent(eventKey, { source: "telegram_business", businessConnectionId: message.business_connection_id, chatId: message.chat.id, messageId: message.message_id, customer: message.from?.id || null, message: message.text });
    if (!claim.claimed) return console.log(JSON.stringify({ event: "duplicate_telegram_event", eventKey, requestId: req.requestId }));
    try { const result = await analyze(message.text, process.env.BUSINESS_NAME); const saved = updateLead(claim.item.id, { ...result.lead, reply: result.reply, status: "completed" }); console.log(JSON.stringify({ event: "lead", id: saved.id, chatId: message.chat.id, score: result.lead.score, intent: result.lead.intent, requestId: req.requestId })); if (result.reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") await sendBusinessMessage({ businessConnectionId: message.business_connection_id, chatId: message.chat.id, text: result.reply }); }
    catch (error) { updateLead(claim.item.id, { status: "failed", error: error.message }); throw error; }
  } catch (error) { console.error(JSON.stringify({ event: "business_webhook_error", requestId: req.requestId, error: error.message })); }
});
app.use((req, res) => res.status(404).json(errorBody("NOT_FOUND", "Endpoint not found", req.requestId)));
const server = app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 2.9.1-x18-agent listening on :${PORT}`));
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;
function shutdown(signal) { console.log(JSON.stringify({ event: "shutdown", signal })); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); }
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
module.exports = { app, server, analyze };
