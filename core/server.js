"use strict";
require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReply, checkOpenAI } = require("./openai");
const { sendBusinessMessage } = require("./business-bot");
const { saveLead, claimEvent, updateLead, listLeads, stats } = require("./store");
const { createRateLimiter } = require("./rate-limit");
const { ingestMessageMedia } = require("./media-ingest");
const { requireWebAppAuth } = require("./webapp-auth");
const { emitHamylionEvent } = require("./hamylion-adapter");
const dualAI = require("./dual-ai/engine");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));
const LEAD_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 60000));
const LEAD_RATE_LIMIT_MAX = Math.max(1, Number(process.env.LEAD_RATE_LIMIT_MAX || 20));
const WEBAPP_MAX_MEDIA_BYTES = Math.max(1024 * 1024, Number(process.env.WEBAPP_MAX_MEDIA_BYTES || 50 * 1024 * 1024));
const WEBAPP_MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "media");

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!API_KEY) missing.push("CORE_API_KEY");
  if (!WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (missing.length) throw new Error(`Production startup blocked: missing ${missing.join(", ")}`);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
app.use(express.json({ limit: "256kb" }));

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
const dualRateLimit = createRateLimiter({ windowMs: Math.max(1000, Number(process.env.DUAL_AI_RATE_LIMIT_WINDOW_MS || 60000)), max: Math.max(1, Number(process.env.DUAL_AI_RATE_LIMIT_MAX || 10)) });
app.use("/dual-ai", express.static(path.join(__dirname, "dual-ai", "public"), { index: "index.html" }));
app.use("/mini-app", express.static(path.join(__dirname, "mini-app"), { index: "index.html" }));

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
app.get("/api/stats", requireApiKey, (req, res) => res.json({ ok: true, stats: stats(), requestId: req.requestId }));\n\nfunction readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Media payload too large");
        error.code = "MEDIA_TOO_LARGE";
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks, total));
    });
    req.on("error", reject);
  });
}

function safeMediaExtension(mime, filename) {
  const allowed = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/heic": ".heic", "image/heif": ".heif", "video/mp4": ".mp4",
    "video/webm": ".webm", "application/pdf": ".pdf"
  };
  return allowed[mime] || path.extname(path.basename(filename || "")) || ".bin";
}

app.post("/api/webapp/media", requireWebAppAuth, async (req, res) => {
  try {
    const mime = String(req.get("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
    const filename = path.basename(String(req.query.filename || req.get("X-Media-Name") || "capture"));
    const ext = safeMediaExtension(mime, filename);
    if (!["image/jpeg","image/png","image/webp","image/heic","image/heif","video/mp4","video/webm","application/pdf"].includes(mime)) {
      return res.status(415).json(errorBody("UNSUPPORTED_MEDIA_TYPE", "Unsupported media type", req.requestId));
    }
    const body = await readRawBody(req, WEBAPP_MAX_MEDIA_BYTES);
    if (!body.length) return res.status(400).json(errorBody("EMPTY_MEDIA", "Media body is empty", req.requestId));

    fs.mkdirSync(WEBAPP_MEDIA_DIR, { recursive: true });
    const storedName = crypto.randomUUID() + ext;
    const storedPath = path.join(WEBAPP_MEDIA_DIR, storedName);
    fs.writeFileSync(storedPath, body, { flag: "wx" });
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    const saved = saveLead({
      source: "telegram_webapp",
      status: "completed",
      telegramUserId: req.telegramWebApp.user.id,
      media: { type: mime.startsWith("video/") ? "video" : "photo", fileName: filename, mimeType: mime, storedName, bytes: body.length, sha256 }
    });
    void emitHamylionEvent("telegram.webapp.media", { telegramUserId: req.telegramWebApp.user.id, media: saved.media, leadId: saved.id }, "webapp-media:" + saved.id).catch(error =>
      console.error(JSON.stringify({ event: "hamylion_media_emit_failed", requestId: req.requestId, error: error.message }))
    );
    return res.status(201).json({ ok: true, media: saved.media, leadId: saved.id, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "MEDIA_TOO_LARGE" ? 413 : 500;
    return res.status(status).json(errorBody(error.code || "MEDIA_UPLOAD_FAILED", status === 413 ? error.message : "Media upload failed", req.requestId));
  }
});

app.post("/api/webapp/location", requireWebAppAuth, async (req, res) => {
  try {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
    const timestamp = req.body?.timestamp == null ? Date.now() : Number(req.body.timestamp);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json(errorBody("INVALID_LOCATION", "Invalid coordinates", req.requestId));
    }
    const location = { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null, timestamp };
    const saved = saveLead({ source: "telegram_webapp", status: "completed", telegramUserId: req.telegramWebApp.user.id, location });
    void emitHamylionEvent("telegram.webapp.location", { telegramUserId: req.telegramWebApp.user.id, location, leadId: saved.id }, "webapp-location:" + saved.id).catch(error =>
      console.error(JSON.stringify({ event: "hamylion_location_emit_failed", requestId: req.requestId, error: error.message }))
    );
    return res.status(201).json({ ok: true, location, leadId: saved.id, requestId: req.requestId });
  } catch (error) {
    return res.status(500).json(errorBody("LOCATION_SAVE_FAILED", "Location save failed", req.requestId));
  }
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
    if (!message?.business_connection_id || !message.chat?.id || !Number.isInteger(message.message_id)) return;

    const eventKey = "telegram:" + message.business_connection_id + ":" + message.chat.id + ":" + message.message_id;
    const claim = claimEvent(eventKey, {
      source: "telegram_business",
      businessConnectionId: message.business_connection_id,
      chatId: message.chat.id,
      messageId: message.message_id,
      customer: message.from?.id || null,
      message: message.text || message.caption || null
    });

    if (!claim.claimed) {
      console.log(JSON.stringify({ event: "duplicate_telegram_event", eventKey, requestId: req.requestId }));
      return;
    }

    try {
      const text = message.text || message.caption || "Медиа-сообщение";
      const result = await analyze(text, process.env.BUSINESS_NAME);

      let attachments = { media: null, location: null };
      try {
        attachments = await ingestMessageMedia(message);
      } catch (mediaError) {
        attachments = {
          media: null,
          location: message.location || null,
          mediaError: mediaError.message
        };
      }

      const saved = updateLead(claim.item.id, {
        ...result.lead,
        reply: result.reply,
        ...attachments,
        status: "completed"
      });

      console.log(JSON.stringify({
        event: "lead",
        id: saved.id,
        chatId: message.chat.id,
        score: result.lead.score,
        intent: result.lead.intent,
        hasMedia: Boolean(saved.media),
        hasLocation: Boolean(saved.location),
        requestId: req.requestId
      }));

      void emitHamylionEvent(
        "telegram.business_message",
        {
          leadId: saved.id,
          businessConnectionId: message.business_connection_id,
          chatId: message.chat.id,
          messageId: message.message_id,
          customer: message.from?.id || null,
          message: text,
          lead: result.lead,
          reply: result.reply,
          media: saved.media,
          location: saved.location
        },
        eventKey
      ).catch(error =>
        console.error(JSON.stringify({
          event: "hamylion_emit_failed",
          requestId: req.requestId,
          error: error.message
        }))
      );

      if (result.reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") {
        await sendBusinessMessage({
          businessConnectionId: message.business_connection_id,
          chatId: message.chat.id,
          text: result.reply
        });
      }
    } catch (error) {
      updateLead(claim.item.id, { status: "failed", error: error.message });
      throw error;
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "business_webhook_error",
      requestId: req.requestId,
      error: error.message
    }));
  }
});

app.use((req, res) => res.status(404).json(errorBody("NOT_FOUND", "Endpoint not found", req.requestId)));

const server = app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 2.7.0 listening on :${PORT}`));
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
