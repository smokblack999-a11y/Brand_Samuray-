"use strict";
require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReplyWithUsage, checkOpenAI } = require("./openai");
const { estimateKZT, ratesFromEnv } = require("./cost-model");
const { sendBusinessMessage } = require("./business-bot");
const telegramCamera = require("./telegram-camera");
const { saveLead, claimEvent, updateLead, listLeads, stats } = require("./store");
const { createRateLimiter } = require("./rate-limit");
const dualAI = require("./dual-ai/engine");
const revenueRuntime = require("./x27-runtime");
const { analyzeLeadLoss } = require("./x28-revenue-rca");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));
const LEAD_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 60000));
const LEAD_RATE_LIMIT_MAX = Math.max(1, Number(process.env.LEAD_RATE_LIMIT_MAX || 20));

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!API_KEY) missing.push("CORE_API_KEY");
  if (!WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (missing.length) throw new Error(`Production startup blocked: missing ${missing.join(", ")}`);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
app.use(express.json({ limit: "16mb" }));

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
function telegramUser() { return require("./telegram"); }
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
function revenueTenantId(req) {
  return String(req.get("X-Tenant-Id") || process.env.TENANT_ID || "default").trim().slice(0, 128) || "default";
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
const dualRateLimit = createRateLimiter({ windowMs: Math.max(1000, Number(process.env.DUAL_AI_RATE_LIMIT_WINDOW_MS || 60000)), max: Math.max(1, Number(process.env.DUAL_AI_RATE_LIMIT_MAX || 10)) });
app.use("/dual-ai", express.static(path.join(__dirname, "dual-ai", "public"), { index: "index.html" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.8.0", revenueEngine: "x27" }));
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
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ ...errorBody("OPENAI_NOT_CONFIGURED", "OpenAI is not configured", req.requestId), configured: false });
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

app.get("/api/revenue/genome", requireApiKey, (req, res) => {
  try {
    const genome = require("./revenue-genome").buildGenome(revenueRuntime.list(revenueTenantId(req), "LEARNING"));
    return res.json({ ok: true, genome, requestId: req.requestId });
  } catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_GENOME_FAILED", "Revenue genome failed", req.requestId)); }
});

app.get("/api/revenue/summary", requireApiKey, (req, res) => {
  try { return res.json({ ok: true, summary: revenueRuntime.summary(revenueTenantId(req)), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_SUMMARY_FAILED", "Revenue summary failed", req.requestId)); }
});
app.post("/api/revenue/experiment/assign", requireApiKey, leadRateLimit, (req, res) => {
  try { const { assignVariant } = require("./experiment-engine"); return res.json({ ok: true, assignment: assignVariant(req.body?.experiment || req.body || {}, req.body?.entityId), requestId: req.requestId }); }
  catch (error) { return res.status(400).json(errorBody(error.code || "EXPERIMENT_ASSIGN_FAILED", error.message || "Experiment assignment failed", req.requestId)); }
});

app.post("/api/revenue/experiment/analyze", requireApiKey, leadRateLimit, (req, res) => {
  try { const { analyzeExperiment } = require("./experiment-engine"); return res.json({ ok: true, analysis: analyzeExperiment(req.body?.records || []), requestId: req.requestId }); }
  catch (error) { return res.status(400).json(errorBody(error.code || "EXPERIMENT_ANALYZE_FAILED", error.message || "Experiment analysis failed", req.requestId)); }
});

app.post("/api/revenue/rca", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const body = req.body || {};
    const result = analyzeLeadLoss(body.events || [], body);
    return res.json({ ok: true, rca: result, requestId: req.requestId });
  } catch (error) {
    return res.status(400).json(errorBody(error.code || "REVENUE_RCA_FAILED", "Revenue RCA failed", req.requestId));
  }
});

app.get("/api/revenue/integrity", requireApiKey, (req, res) => {
  try { return res.json({ ok: true, integrity: revenueRuntime.integrity(revenueTenantId(req)), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_INTEGRITY_FAILED", "Revenue integrity check failed", req.requestId)); }
});

app.post("/api/revenue/cost", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const body = req.body || {};
    const record = require("./revenue-ledger").appendCost(Object.assign({}, body, { tenantId })).record;
    return res.status(201).json({ ok: true, cost: record, requestId: req.requestId });
  } catch (error) {
    const status = /required/.test(String(error.message || "")) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "REVENUE_COST_FAILED", status === 400 ? error.message : "Revenue cost failed", req.requestId));
  }
});

app.get("/api/revenue/ledger", requireApiKey, (req, res) => {
  try { const type = req.query.type ? String(req.query.type).toUpperCase() : undefined; return res.json({ ok: true, records: revenueRuntime.list(revenueTenantId(req), type), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_LEDGER_FAILED", "Revenue ledger read failed", req.requestId)); }
});
app.post("/api/revenue/decision", requireApiKey, leadRateLimit, (req, res) => {
  try { const result = revenueRuntime.decide(revenueTenantId(req), req.body || {}); return res.status(201).json({ ok: true, ...result, requestId: req.requestId }); }
  catch (error) { const status = /required/.test(String(error.message || "")) ? 400 : 500; return res.status(status).json(errorBody(error.code || "REVENUE_DECISION_FAILED", status === 400 ? error.message : "Revenue decision failed", req.requestId)); }
});
app.post("/api/revenue/outcome", requireApiKey, leadRateLimit, (req, res) => {
  try { const result = revenueRuntime.recordOutcome(revenueTenantId(req), req.body || {}); return res.status(result.inserted ? 201 : 200).json({ ok: true, ...result, requestId: req.requestId }); }
  catch (error) { const status = /required|Unsupported outcome/.test(String(error.message || "")) ? 400 : 500; return res.status(status).json(errorBody(error.code || "REVENUE_OUTCOME_FAILED", status === 400 ? error.message : "Revenue outcome failed", req.requestId)); }
});
app.get("/api/dual-ai/config", requireApiKey, (req, res) => res.json({ ok: true, config: dualAI.config(), requestId: req.requestId }));

app.get("/api/dual-ai/sessions", requireApiKey, (req, res) => res.json({ ok: true, sessions: dualAI.list(), requestId: req.requestId }));

app.get("/api/dual-ai/session/:id", requireApiKey, (req, res) => {
  const session = dualAI.get(req.params.id);
  if (!session) return res.status(404).json(errorBody("SESSION_NOT_FOUND", "Session not found", req.requestId));
  return res.json({ ok: true, session, requestId: req.requestId });
});

app.post("/api/dual-ai/session", requireApiKey, dualRateLimit, (req, res) => {
  try {
    const session = dualAI.create(req.body || {});
    return res.status(201).json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = ["TASK_REQUIRED", "TASK_TOO_LONG"].includes(error.code) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "DUAL_AI_CREATE_FAILED", status === 500 ? "Internal server error" : error.message, req.requestId));
  }
});

app.post("/api/dual-ai/turn", requireApiKey, dualRateLimit, async (req, res) => {
  try {
    const session = await dualAI.next(String(req.body?.id || ""));
    return res.json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "SESSION_NOT_FOUND" ? 404 : error.code === "SESSION_NOT_RUNNING" ? 409 : 500;
    console.error(JSON.stringify({ event: "dual_ai_turn_failed", requestId: req.requestId, code: error.code || "INTERNAL_ERROR" }));
    return res.status(status).json(errorBody(error.code || "DUAL_AI_TURN_FAILED", status === 500 ? "Dual AI turn failed" : error.message, req.requestId));
  }
});

app.post("/api/dual-ai/stop", requireApiKey, (req, res) => {
  try {
    const session = dualAI.stop(String(req.body?.id || ""));
    return res.json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "SESSION_NOT_FOUND" ? 404 : error.code === "SESSION_NOT_RUNNING" ? 409 : 500;
    return res.status(status).json(errorBody(error.code || "DUAL_AI_STOP_FAILED", status === 500 ? "Dual AI stop failed" : error.message, req.requestId));
  }
});

app.get("/api/dual-ai/export/:id", requireApiKey, (req, res) => {
  try {
    const json = dualAI.exportData(req.params.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dual-ai-${req.params.id}.json"`);
    return res.send(json);
  } catch (error) {
    return res.status(404).json(errorBody("SESSION_NOT_FOUND", "Session not found", req.requestId));
  }
});


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
  let reply = null;
  let aiTelemetry = null;
  if (process.env.OPENAI_API_KEY) {
    const generated = await generateReplyWithUsage({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead });
    reply = generated.text;
    const pricing = estimateKZT({ usage: generated.usage, rates: ratesFromEnv() });
    aiTelemetry = Object.assign({ provider: generated.provider, model: generated.model }, pricing);
  }
  return { lead, reply, aiTelemetry };
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

app.get("/api/telegram/me", requireApiKey, async (req, res) => {
  try {
    const result = await telegramCamera.getMe();
    return res.json({ ok: true, telegram: result, requestId: req.requestId });
  } catch (error) {
    return res.status(503).json(errorBody(error.code || "TELEGRAM_UNAVAILABLE", "Telegram unavailable", req.requestId));
  }
});

app.get("/api/telegram/dialogs", requireApiKey, async (req, res) => {
  try {
    const result = await telegramUser().getDialogs(req.query.limit);
    return res.json({ ok: true, dialogs: result, requestId: req.requestId });
  } catch (error) {
    return res.status(503).json(errorBody(error.code || "TELEGRAM_USER_UNAVAILABLE", "Telegram user session unavailable", req.requestId));
  }
});

app.get("/api/telegram/messages", requireApiKey, async (req, res) => {
  try {
    const chatId = String(req.query.chatId || "").trim();
    if (!chatId) return res.status(400).json(errorBody("INVALID_CHAT_ID", "chatId is required", req.requestId));
    const result = await telegramUser().getMessages(chatId, req.query.limit);
    return res.json({ ok: true, messages: result, requestId: req.requestId });
  } catch (error) {
    return res.status(503).json(errorBody(error.code || "TELEGRAM_USER_UNAVAILABLE", "Telegram user session unavailable", req.requestId));
  }
});

app.post("/api/telegram/send", requireApiKey, async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!chatId || !message) return res.status(400).json(errorBody("INVALID_TELEGRAM_MESSAGE", "chatId and message are required", req.requestId));
    const result = await telegramCamera.sendMessage({ chatId, message });
    return res.json({ ok: true, result, requestId: req.requestId });
  } catch (error) {
    return res.status(502).json(errorBody(error.code || "TELEGRAM_SEND_FAILED", "Telegram send failed", req.requestId));
  }
});

app.post("/api/telegram/send-photo", requireApiKey, async (req, res) => {
  try {
    const { chatId, fileName, caption, base64, latitude, longitude } = req.body || {};
    if (!String(chatId || "").trim() || !String(base64 || "").trim()) {
      return res.status(400).json(errorBody("INVALID_TELEGRAM_PHOTO", "chatId and base64 photo are required", req.requestId));
    }
    const result = await telegramCamera.sendPhoto({
      chatId: String(chatId).trim(),
      fileName,
      caption,
      base64: String(base64),
      latitude,
      longitude,
    });
    return res.json({ ok: true, result, locationSent: latitude != null && longitude != null, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "TELEGRAM_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json(errorBody(error.code || "TELEGRAM_PHOTO_FAILED", status === 503 ? "Telegram is not configured" : "Telegram photo send failed", req.requestId));
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
       const revenueDecision = revenueRuntime.decide("telegram:" + message.business_connection_id, {
         leadScore: result.lead.score,
         intent: result.lead.intent,
         dealValue: Number(process.env.DEFAULT_DEAL_VALUE_KZT || 200000),
         grossMargin: Number(process.env.DEFAULT_GROSS_MARGIN || 0.30),
         occurredAt: message.date ? new Date(Number(message.date) * 1000).toISOString() : new Date().toISOString(),
         responseSlaBreached: false,
         triggerRelevance: result.lead.intent === "hot" ? 0.8 : result.lead.intent === "warm" ? 0.5 : 0.2,
         contactAllowed: true,
         customerOptedOut: false
       });
       const saved = updateLead(claim.item.id, { ...result.lead, reply: result.reply, revenueDecision: revenueDecision.record, status: "completed" });
       if (result.aiTelemetry) revenueRuntime.recordExecutionCost("telegram:" + message.business_connection_id, revenueDecision.record.decisionId, eventKey + ":ai", result.aiTelemetry);
       console.log(JSON.stringify({ event: "lead", id: saved.id, chatId: message.chat.id, score: result.lead.score, intent: result.lead.intent, action: revenueDecision.record.action, requestId: req.requestId }));
       const autoReply = String(process.env.AUTO_REPLY).toLowerCase() === "true";
       const revenueGate = String(process.env.REVENUE_AUTO_GATE || "false").toLowerCase() === "true";
       const action = revenueDecision.record.action || revenueDecision.record.recommendedAction;
       const allowedByRevenue = ["RESPOND", "FOLLOW_UP", "REACTIVATE"].includes(action);
       if (result.reply && autoReply && (!revenueGate || allowedByRevenue)) {
         await sendBusinessMessage({ businessConnectionId: message.business_connection_id, chatId: message.chat.id, text: result.reply });
       }
       } catch (error) {
      updateLead(claim.item.id, { status: "failed", error: error.message });
      throw error;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "business_webhook_error", requestId: req.requestId, error: error.message }));
  }
});

app.use((req, res) => res.status(404).json(errorBody("NOT_FOUND", "Endpoint not found", req.requestId)));

const server = app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 2.8.0 listening on :${PORT}`));
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;

function shutdown(signal) {
  console.log(JSON.stringify({ event: "shutdown", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, analyze };
