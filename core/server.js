"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReply, checkOpenAI } = require("./openai");
const { sendBusinessMessage } = require("./business-bot");
const { saveLead, listLeads, stats, hasEvent } = require("./store");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "");
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function requireApiKey(req, res, next) {
  if (!API_KEY || req.get("X-API-Key") === API_KEY) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.3.0" }));
app.get("/health/openai", requireApiKey, async (_req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ ok: false, service: "openai", configured: false });
  }
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
  const lead = scoreLead(text);
  const reply = process.env.OPENAI_API_KEY ? await generateReply({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead }) : null;
  return { lead, reply };
}

app.post("/api/lead/analyze", requireApiKey, async (req, res) => {
  try {
    const { message, business } = req.body || {};
    const result = await analyze(message, business);
    const saved = saveLead({ source: "api", message: String(message).trim(), ...result.lead, reply: result.reply });
    res.json({ ok: true, ...result, saved });
  } catch (error) {
    console.error(JSON.stringify({ event: "lead_analyze_failed", error: error.message }));
    const status = /authentication|rate limit|temporarily unavailable|timed out/.test(error.message) ? 503 : 400;
    res.status(status).json({ ok: false, error: error.message });
  }
});

app.post("/api/telegram/webhook", async (req, res) => {
  if (WEBHOOK_SECRET && req.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  res.sendStatus(200);
  try {
    const update = req.body || {};
    if (update.business_connection) {
      console.log(JSON.stringify({ event: "business_connection", id: update.business_connection.id }));
      return;
    }

    const message = update.business_message;
    if (!message?.text || !message.business_connection_id || !message.chat?.id) return;

    const eventKey = `telegram:${message.business_connection_id}:${message.chat.id}:${message.message_id}`;
    if (hasEvent(eventKey)) {
      console.log(JSON.stringify({ event: "duplicate_telegram_event", eventKey }));
      return;
    }

    const result = await analyze(message.text, process.env.BUSINESS_NAME);
    const saved = saveLead({
      source: "telegram_business",
      eventKey,
      businessConnectionId: message.business_connection_id,
      chatId: message.chat.id,
      messageId: message.message_id,
      customer: message.from?.id || null,
      message: message.text,
      ...result.lead,
      reply: result.reply
    });
    console.log(JSON.stringify({ event: "lead", id: saved.id, chatId: message.chat.id, score: result.lead.score, intent: result.lead.intent }));

    if (result.reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") {
      await sendBusinessMessage({ businessConnectionId: message.business_connection_id, chatId: message.chat.id, text: result.reply });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "business_webhook_error", error: error.message }));
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: "Endpoint not found" }));
app.listen(PORT, "0.0.0.0", () => console.log(`SamuraiOS Core 2.3.0 listening on :${PORT}`));

module.exports = { app };
