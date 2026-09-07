"use strict";

require("dotenv").config();

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const session = process.env.TELEGRAM_SESSION;

if (!apiId || !apiHash || !session) throw new Error("Telegram ENV не настроен");

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

module.exports = { client, connectTelegram, telegramStatus, getMe, getDialogs, getMessages, sendMessage, sendPhoto };
