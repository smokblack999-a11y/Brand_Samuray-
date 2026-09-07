"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReply } = require("./openai");
const { sendBusinessMessage } = require("./business-bot");

const app = express();
const PORT = Number(process.env.PORT || 8787);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.0.0" }));

app.post("/api/lead/analyze", async (req, res) => {
  try {
    const { message, business } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ ok: false, error: "message обязателен" });
    const lead = scoreLead(message);
    let reply = null;
    if (process.env.OPENAI_API_KEY) reply = await generateReply({ business: business || process.env.BUSINESS_NAME, customerMessage: String(message), lead });
    res.json({ ok: true, lead, reply, mode: reply ? "ai" : "scoring-only" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/telegram/webhook", async (req, res) => {
  // Always acknowledge quickly; Telegram retries slow/failing webhooks.
  res.sendStatus(200);
  try {
    const update = req.body || {};
    if (update.business_connection) {
      console.log("Business connection:", update.business_connection.id, update.business_connection.user?.id);
      return;
    }

    const message = update.business_message;
    if (!message?.text || !message.business_connection_id || !message.chat?.id) return;

    const lead = scoreLead(message.text);
    const reply = process.env.OPENAI_API_KEY
      ? await generateReply({ business: process.env.BUSINESS_NAME, customerMessage: message.text, lead })
      : null;

    console.log(JSON.stringify({ event: "lead", chatId: message.chat.id, score: lead.score, intent: lead.intent }));

    if (reply && String(process.env.AUTO_REPLY).toLowerCase() === "true") {
      await sendBusinessMessage({
        businessConnectionId: message.business_connection_id,
        chatId: message.chat.id,
        text: reply
      });
    }
  } catch (error) {
    console.error("Business webhook error:", error.message);
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: "Endpoint not found" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SamuraiOS Core 2.0.0 listening on :${PORT}`);
});
