"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const session = process.env.TELEGRAM_SESSION;

if (!apiId || !apiHash || !session) {
  const error = new Error("Telegram user session is not configured");
  error.code = "TELEGRAM_NOT_CONFIGURED";
  throw error;
}

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });

async function connectTelegram() {
  if (!client.connected) await client.connect();
  const me = await client.getMe();
  console.log("TELEGRAM CONNECTED", me.id, `@${me.username || "none"}`);
  return me;
}

async function ensureConnected() { if (!client.connected) await connectTelegram(); }
async function telegramStatus() { return { connected: client.connected }; }

async function getMe() {
  await ensureConnected();
  const me = await client.getMe();
  return { id: String(me.id), username: me.username || null, firstName: me.firstName || null, lastName: me.lastName || null, phone: me.phone || null };
}

async function getDialogs(limit = 20) {
  await ensureConnected();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const dialogs = await client.getDialogs({ limit: safeLimit });
  return dialogs.map((dialog) => {
    const entity = dialog.entity;
    return { id: String(dialog.id), name: dialog.name || entity?.title || entity?.firstName || entity?.username || null, username: entity?.username || null, unreadCount: dialog.unreadCount || 0, pinned: Boolean(dialog.pinned) };
  });
}

async function getMessages(chatId, limit = 20) {
  await ensureConnected();
  if (!chatId) throw new Error("chatId обязателен");
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const messages = await client.getMessages(String(chatId), { limit: safeLimit });
  return messages.map((msg) => ({ id: String(msg.id), text: msg.message || "", date: msg.date ? new Date(msg.date * 1000).toISOString() : null, out: Boolean(msg.out), senderId: msg.senderId ? String(msg.senderId) : null, replyToMsgId: msg.replyToMsgId ? String(msg.replyToMsgId) : null }));
}

async function sendMessage(chatId, message) {
  await ensureConnected();
  if (!chatId) throw new Error("chatId обязателен");
  if (!message || !String(message).trim()) throw new Error("message обязателен");
  const result = await client.sendMessage(String(chatId), { message: String(message) });
  return { messageId: String(result.id), chatId: String(chatId), text: result.message || String(message), date: result.date ? new Date(result.date * 1000).toISOString() : new Date().toISOString() };
}

async function sendPhoto(chatId, filePath, caption = "SamuraiOS") {
  await ensureConnected();
  if (!chatId) throw new Error("chatId обязателен");
  const result = await client.sendFile(String(chatId), { file: filePath, caption: String(caption) });
  return { chatId: String(chatId), messageId: result?.id ? String(result.id) : null, caption: String(caption) };
}

async function sendPhotoBase64({ chatId, fileName, caption, base64, latitude, longitude }) {
  await ensureConnected();
  if (!String(chatId || "").trim()) {
    const error = new Error("chatId обязателен");
    error.code = "INVALID_CHAT_ID";
    throw error;
  }
  if (typeof base64 !== "string" || !base64.trim()) {
    const error = new Error("base64 фото обязательно");
    error.code = "INVALID_PHOTO";
    throw error;
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    const error = new Error("Фото пустое или превышает лимит 10 МБ");
    error.code = "INVALID_PHOTO_SIZE";
    throw error;
  }
  const safeName = path.basename(String(fileName || "photo.jpg")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "photo.jpg";
  const tempPath = path.join(os.tmpdir(), `samurai-${Date.now()}-${safeName}`);
  let finalCaption = String(caption || "SamuraiOS");
  if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
    finalCaption = `${finalCaption}\nGPS: ${Number(latitude)}, ${Number(longitude)}`;
  }
  try {
    await fs.writeFile(tempPath, bytes, { flag: "wx", mode: 0o600 });
    const result = await client.sendFile(String(chatId), { file: tempPath, caption: finalCaption });
    return { chatId: String(chatId), messageId: result?.id ? String(result.id) : null, caption: finalCaption };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

module.exports = { client, connectTelegram, telegramStatus, getMe, getDialogs, getMessages, sendMessage, sendPhoto };
