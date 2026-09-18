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
const { getMe, sendMessage, sendLocation, sendPhoto } = require("./telegram-camera");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));
const leadRateLimit = createRateLimiter({
  windowMs: Math.max(1000, Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 60000)),
  max: Math.max(1, Number(process.env.LEAD_RATE_LIMIT_MAX || 20)),
});

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!API_KEY) missing.push("CORE_API_KEY");
  if (!WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (missing.length) throw new Error(`Production startup blocked: missing ${missing.join(", ")}`);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
// Camera photos are sent as base64 in the MVP; keep a bounded 12 MB JSON envelope.
app.use(express.json({ limit: "12mb" }));

function errorBody(code, message, requestId) { return { ok: false, error: { code, message, requestId } }; }
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
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const timer = setTimeout(() => { if (!res.headersSent) res.status(503).json(errorBody("REQUEST_TIMEOUT", "Request timed out", req.requestId)); }, REQUEST_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer));
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "3.0.0-camera" }));
app.get("/ready", (_req, res) => res.json({ ok: true, camera: true, telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) }));
app.get("/health/openai", requireApiKey, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json(errorBody("OPENAI_NOT_CONFIGURED", "OpenAI is not configured", req.requestId));
  try { await checkOpenAI(); res.json({ ok: true, service: "openai", configured: true, requestId: req.requestId }); }
  catch (error) { res.status(503).json(errorBody("OPENAI_UNAVAILABLE", "OpenAI service is unavailable", req.requestId)); }
});

app.get("/api/telegram/me", async (req, res) => {
  try { res.json({ ok: true, bot: await getMe(), requestId: req.requestId }); }
  catch (error) { res.status(503).json(errorBody(error.code || "TELEGRAM_ERROR", error.message, req.requestId)); }
});
app.post("/api/telegram/send", async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!chatId || !message) return res.status(400).json(errorBody("INVALID_REQUEST", "chatId and message are required", req.requestId));
    const result = await sendMessage({ chatId, message });
    res.json({ ok: true, result, requestId: req.requestId });
  } catch (error) { res.status(503).json(errorBody(error.code || "TELEGRAM_ERROR", error.message, req.requestId)); }
});
app.post("/api/telegram/send-location", async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || "").trim();
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    if (!chatId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return res.status(400).json(errorBody("INVALID_LOCATION", "chatId, latitude and longitude are required", req.requestId));
    const result = await sendLocation({ chatId, latitude, longitude });
    res.json({ ok: true, result, requestId: req.requestId });
  } catch (error) { res.status(503).json(errorBody(error.code || "TELEGRAM_ERROR", error.message, req.requestId)); }
});
app.post("/api/telegram/send-photo", async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || "").trim();
    const base64 = String(req.body?.base64 || "").replace(/^data:image\/[^;]+;base64,/, "");
    if (!chatId || !base64) return res.status(400).json(errorBody("INVALID_PHOTO", "chatId and base64 photo are required", req.requestId));
    const result = await sendPhoto({
      chatId,
      fileName: req.body?.fileName,
      caption: req.body?.caption,
      base64,
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
    });
    res.json({ ok: true, result, locationSent: req.body?.latitude != null && req.body?.longitude != null, requestId: req.requestId });
  } catch (error) { res.status(503).json(errorBody(error.code || "TELEGRAM_ERROR", error.message, req.requestId)); }
});

async function analyze(message, business) {
  const text = String(message || "").trim();
  if (!text) { const error = new Error("message обязателен"); error.code = "INVALID_MESSAGE"; throw error; }
  if (text.length > MAX_MESSAGE_CHARS) { const error = new Error(`message слишком длинный (максимум ${MAX_MESSAGE_CHARS} символов)`); error.code = "MESSAGE_TOO_LONG"; throw error; }
  const lead = scoreLead(text);
  const reply = process.env.OPENAI_API_KEY ? await generateReply({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead }) : null;
  return { lead, reply };
}
app.get("/api/leads", requireApiKey, (req, res) => res.json({ ok: true, leads: listLeads(req.query.limit), requestId: req.requestId }));
app.get("/api/stats", requireApiKey, (req, res) => res.json({ ok: true, stats: stats(), requestId: req.requestId }));
app.post("/api/lead/analyze", requireApiKey, leadRateLimit, async (req, res) => {
  try { const { message, business } = req.body || {}; const result = await analyze(message, business); const saved = saveLead({ source: "api", message: String(message).trim(), ...result.lead, reply: result.reply }); res.json({ ok: true, ...result, saved, requestId: req.requestId }); }
  catch (error) { const status = error.code === "INVALID_MESSAGE" || error.code === "MESSAGE_TOO_LONG" ? 400 : 500; res.status(status).json(errorBody(error.code || "INTERNAL_ERROR", status === 500 ? "Internal server error" : error.message, req.requestId)); }
});

app.post("/api/telegram/webhook", requireWebhookSecret, async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body || {};
    if (update.business_connection) return;
    const message = update.business_message;
    if (!message?.text || !message.business_connection_id || !message.chat?.id || !Number.isInteger(message.message_id)) return;
    const eventKey = `telegram:${message.business_connection_id}:${message.chat.id}:${message.message_id}`;
    const claim = claimEvent(eventKey, { source: "telegram_business", businessConnectionId: message.business_connection_id, chatId: message.chat.id, messageId: message.message_id, customer: message.from?.id || null, message: message.text });
    if (!claim.claimed) return;
    try { const result = await analyze(message.text, process.env.BUSINESS_NAME); updateLead(claim.item.id, { ...result.lead, reply: result.reply, status: "completed" }); if (result.reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") await sendBusinessMessage({ businessConnectionId: message.business_connection_id, chatId: message.chat.id, text: result.reply }); }
    catch (error) { updateLead(claim.item.id, { status: "failed", error: error.message }); }
  } catch (error) { console.error(JSON.stringify({ event: "business_webhook_error", requestId: req.requestId, error: error.message })); }
});

app.use((req, res) => res.status(404).json(errorBody("NOT_FOUND", "Endpoint not found", req.requestId)));
const server = app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 3.0.0-camera listening on :${PORT}`));
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;
function shutdown(signal) { console.log(JSON.stringify({ event: "shutdown", signal })); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); }
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
module.exports = { app, server, analyze };
