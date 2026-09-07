"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  connectTelegram,
  telegramStatus,
  getMe,
  getDialogs,
  getMessages,
  sendMessage,
  sendPhoto,
} = require("./telegram");

const app = express();
const HOST = "127.0.0.1";
const PORT = 8787;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/api/status", async (req, res) => {
  res.json({
    ok: true,
    service: "SamuraiOS Core",
    version: "1.2.0",
    openai: Boolean(process.env.OPENAI_API_KEY),
    telegram: await telegramStatus(),
    time: new Date().toISOString(),
  });
});

app.get("/api/telegram/me", async (req, res) => {
  try { res.json({ ok: true, telegram: await getMe() }); }
  catch (error) { console.error("Telegram /me error:", error); res.status(500).json({ ok: false, error: error.message }); }
});

app.get("/api/telegram/dialogs", async (req, res) => {
  try { res.json({ ok: true, dialogs: await getDialogs(req.query.limit || 20) }); }
  catch (error) { console.error("Telegram dialogs error:", error); res.status(500).json({ ok: false, error: error.message }); }
});

app.get("/api/telegram/messages", async (req, res) => {
  try {
    const { chatId } = req.query;
    if (!chatId) return res.status(400).json({ ok: false, error: "chatId обязателен" });
    const messages = await getMessages(chatId, req.query.limit || 20);
    res.json({ ok: true, chatId: String(chatId), count: messages.length, messages });
  } catch (error) { console.error("Telegram messages error:", error); res.status(500).json({ ok: false, error: error.message }); }
});

app.post("/api/telegram/send", async (req, res) => {
  try {
    const { chatId, message } = req.body;
    if (!chatId) return res.status(400).json({ ok: false, error: "chatId обязателен" });
    if (!message || !String(message).trim()) return res.status(400).json({ ok: false, error: "message обязателен" });
    res.json({ ok: true, result: await sendMessage(chatId, message) });
  } catch (error) { console.error("Telegram send error:", error); res.status(500).json({ ok: false, error: error.message }); }
});

app.post("/api/telegram/send-photo", async (req, res) => {
  let tempFile = null;
  try {
    const { chatId, fileName, caption, base64 } = req.body;
    if (!chatId) return res.status(400).json({ ok: false, error: "chatId обязателен" });
    if (!base64) return res.status(400).json({ ok: false, error: "base64 обязателен" });
    if (base64.length > 18_000_000) return res.status(413).json({ ok: false, error: "Фото слишком большое" });

    const safeName = String(fileName || "samurai_photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
    tempFile = path.join(os.tmpdir(), `samurai-${Date.now()}-${safeName}`);
    fs.writeFileSync(tempFile, Buffer.from(base64, "base64"));

    const result = await sendPhoto(chatId, tempFile, caption || "SamuraiOS");
    res.json({ ok: true, result });
  } catch (error) {
    console.error("Telegram photo error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (tempFile) { try { fs.unlinkSync(tempFile); } catch (_) {} }
  }
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Endpoint not found", method: req.method, path: req.path }));

app.listen(PORT, HOST, async () => {
  console.log("================================");
  console.log("       SAMURAIOS CORE 1.2.0");
  console.log(`http://${HOST}:${PORT}`);
  console.log("================================");
  try { await connectTelegram(); }
  catch (error) { console.error("Telegram connection error:", error.message); }
});
