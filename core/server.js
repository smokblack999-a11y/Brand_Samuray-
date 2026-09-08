"use strict";
require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReply, checkOpenAI } = require("./openai");
const { sendBusinessMessage } = require("./business-bot");
const { saveLead, claimEvent, updateLead, listLeads, stats } = require("./store");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));

app.disable("x-powered-by");
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
app.use(express.json({ limit: "256kb" }));

function safeEqual(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(503).json({ ok: false, error: "API authentication is not configured" });
  if (safeEqual(API_KEY, req.get("X-API-Key"))) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}
function requireWebhookSecret(req, res, next) {
  if (!WEBHOOK_SECRET) return res.status(503).json({ ok: false, error: "Webhook authentication is not configured" });
  if (safeEqual(WEBHOOK_SECRET, req.get("X-Telegram-Bot-Api-Secret-Token"))) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
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
    if (!res.headersSent) res.status(503).json({ ok: false, error: "Request timed out", requestId: req.requestId });
  }, REQUEST_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer));
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.6.0" }));
app.get("/ready", (_req, res) => {
  try {
    const current = stats();
    const ready = Boolean(API_KEY && WEBHOOK_SECRET && current && Number.isFinite(current.total));
    return res.status(ready ? 200 : 503).json({ ok: ready, service: "SamuraiOS Core", ready });
  } catch (error) {
    return res.status(503).json({ ok: false, ready: false, error: error.message });
  }
});
app.get("/health/openai", requireApiKey, async (_req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ ok: false, service: "openai", configured: false });
  try {
    await checkOpenAI();
    return res.json({ ok: true, service: "openai", configured: true });
  } catch (error) {
    console.error(JSON.stringify({ event: "openai_health_failed", error: error.message }));
    return res.status(503).json({ ok: false, service: "openai", configured: true, error: error.message });
  }
});
app.get("/api/leads", requireApiKey, (req, res) => res.json({ ok: true, leads: listLeads(req.query.limit) }));
app.get("/api/stats", requireApiKey, (_req, res) => res.json({ ok: true, stats: stats() }));

async function analyze(message, business) {
  const text = String(message || "").trim();
  if (!text) throw new Error("message обязателен");
  if (text.length > MAX_MESSAGE_CHARS) throw new Error(`message слишком длинный (максимум ${MAX_MESSAGE_CHARS} символов)`);
  const lead = scoreLead(text);
  const reply = process.env.OPENAI_API_KEY
    ? await generateReply({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead })
    : null;
  return { lead, reply };
}

app.post("/api/lead/analyze", requireApiKey, async (req, res) => {
  try {
    const { message, business } = req.body || {};
    const result = await analyze(message, business);
    const saved = saveLead({ source: "api", message: String(message).trim(), ...result.lead, reply: result.reply });
    res.json({ ok: true, ...result, saved, requestId: req.requestId });
  } catch (error) {
    console.error(JSON.stringify({ event: "lead_analyze_failed", requestId: req.requestId, error: error.message }));
    const status = /authentication|rate limit|temporarily unavailable|timed out/.test(error.message) ? 503 : 400;
    res.status(status).json({ ok: false, error: error.message, requestId: req.requestId });
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
    const claim = claimEvent(eventKey, {
      source: "telegram_business",
      businessConnectionId: message.business_connection_id,
      chatId: message.chat.id,
      messageId: message.message_id,
      customer: message.from?.id || null,
      message: message.text
    });
    if (!claim.claimed) {
      console.log(JSON.stringify({ event: "duplicate_telegram_event", eventKey, requestId: req.requestId }));
      return;
    }

    try {
      const result = await analyze(message.text, process.env.BUSINESS_NAME);
      const saved = updateLead(claim.item.id, { ...result.lead, reply: result.reply, status: "completed" });
      console.log(JSON.stringify({ event: "lead", id: saved.id, chatId: message.chat.id, score: result.lead.score, intent: result.lead.intent, requestId: req.requestId }));

      if (result.reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") {
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

app.use((_req, res) => res.status(404).json({ ok: false, error: "Endpoint not found" }));

const server = app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 2.6.0 listening on :${PORT}`));
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
