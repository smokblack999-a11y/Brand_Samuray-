"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
let client = null;

function telegramError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getClient() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();
  const session = String(process.env.TELEGRAM_SESSION || "").trim();

  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash || !session) {
    throw telegramError("TELEGRAM_NOT_CONFIGURED", "Telegram user session is not configured");
  }

  if (!client) {
    client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 5
    });
  }
  return client;
}

async function ensureConnected() {
  const telegram = getClient();
  if (!telegram.connected) await telegram.connect();
  return telegram;
}

async function connectTelegram() {
  const telegram = await ensureConnected();
  const me = await telegram.getMe();
  console.log("TELEGRAM CONNECTED", me.id, `@${me.username || "none"}`);
  return me;
}

async function telegramStatus() {
  return { connected: Boolean(client?.connected) };
}

async function getMe() {
  const telegram = await ensureConnected();
  const me = await telegram.getMe();
  return {
    id: String(me.id),
    username: me.username || null,
    firstName: me.firstName || null,
    lastName: me.lastName || null,
    phone: me.phone || null
  };
}

async function getDialogs(limit = 20) {
  const telegram = await ensureConnected();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const dialogs = await telegram.getDialogs({ limit: safeLimit });
  return dialogs.map((dialog) => {
    const entity = dialog.entity;
    return {
      id: String(dialog.id),
      name: dialog.name || entity?.title || entity?.firstName || entity?.username || null,
      username: entity?.username || null,
      unreadCount: dialog.unreadCount || 0,
      pinned: Boolean(dialog.pinned)
    };
  });
}

async function getMessages(chatId, limit = 20) {
  if (!String(chatId || "").trim()) throw telegramError("INVALID_CHAT_ID", "chatId обязателен");
  const telegram = await ensureConnected();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const messages = await telegram.getMessages(String(chatId), { limit: safeLimit });
  return messages.map((msg) => ({
    id: String(msg.id),
    text: msg.message || "",
    date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
    out: Boolean(msg.out),
    senderId: msg.senderId ? String(msg.senderId) : null,
    replyToMsgId: msg.replyToMsgId ? String(msg.replyToMsgId) : null
  }));
}

async function sendMessage(chatId, message) {
  if (!String(chatId || "").trim()) throw telegramError("INVALID_CHAT_ID", "chatId обязателен");
  if (!String(message || "").trim()) throw telegramError("INVALID_MESSAGE", "message обязателен");
  const telegram = await ensureConnected();
  const result = await telegram.sendMessage(String(chatId), { message: String(message) });
  return {
    messageId: String(result.id),
    chatId: String(chatId),
    text: result.message || String(message),
    date: result.date ? new Date(result.date * 1000).toISOString() : new Date().toISOString()
  };
}

async function sendPhoto(chatId, filePath, caption = "SamuraiOS") {
  if (!String(chatId || "").trim()) throw telegramError("INVALID_CHAT_ID", "chatId обязателен");
  if (!String(filePath || "").trim()) throw telegramError("INVALID_PHOTO", "filePath обязателен");
  const telegram = await ensureConnected();
  const result = await telegram.sendFile(String(chatId), { file: filePath, caption: String(caption) });
  return { chatId: String(chatId), messageId: result?.id ? String(result.id) : null, caption: String(caption) };
}

function decodePhoto(base64) {
  if (typeof base64 !== "string" || !base64.trim()) {
    throw telegramError("INVALID_PHOTO", "base64 фото обязательно");
  }

  const normalized = base64.trim()
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s+/g, "");

  const maxEncodedLength = 4 * Math.ceil(MAX_PHOTO_BYTES / 3);
  if (normalized.length > maxEncodedLength) {
    throw telegramError("INVALID_PHOTO_SIZE", "Фото превышает лимит 10 МБ");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw telegramError("INVALID_PHOTO", "Фото имеет некорректный Base64");
  }

  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) throw telegramError("INVALID_PHOTO", "Фото пустое");
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw telegramError("INVALID_PHOTO_SIZE", "Фото превышает лимит 10 МБ");
  }
  if (bytes.toString("base64") !== normalized) {
    throw telegramError("INVALID_PHOTO", "Фото имеет некорректный Base64");
  }
  return bytes;
}

async function sendPhotoBase64({ chatId, fileName, caption, base64, latitude, longitude } = {}) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) throw telegramError("INVALID_CHAT_ID", "chatId обязателен");
  const bytes = decodePhoto(base64);
  const telegram = await ensureConnected();

  const safeName = path.basename(String(fileName || "photo.jpg"))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100) || "photo.jpg";
  const tempPath = path.join(os.tmpdir(), `samurai-${crypto.randomUUID()}-${safeName}`);
  let finalCaption = String(caption || "SamuraiOS").slice(0, 900);
  const lat = latitude == null || latitude === "" ? null : Number(latitude);
  const lon = longitude == null || longitude === "" ? null : Number(longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    finalCaption = `${finalCaption}\nGPS: ${lat}, ${lon}`.slice(0, 1024);
  }

  try {
    await fs.writeFile(tempPath, bytes, { flag: "wx", mode: 0o600 });
    const result = await telegram.sendFile(normalizedChatId, { file: tempPath, caption: finalCaption });
    return {
      chatId: normalizedChatId,
      messageId: result?.id ? String(result.id) : null,
      caption: finalCaption
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

module.exports = {
  client: null,
  connectTelegram,
  telegramStatus,
  getMe,
  getDialogs,
  getMessages,
  sendMessage,
  sendPhoto,
  sendPhotoBase64
};
