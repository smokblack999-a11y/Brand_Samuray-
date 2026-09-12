"use strict";

const TELEGRAM_API = "https://api.telegram.org";

function token() {
  const value = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!value) {
    const error = new Error("TELEGRAM_BOT_TOKEN is not configured");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }
  return value;
}

async function callTelegram(method, body) {
  const response = await fetch(`${TELEGRAM_API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.description || `Telegram HTTP ${response.status}`);
    error.code = "TELEGRAM_API_ERROR";
    error.status = response.status;
    throw error;
  }
  return data.result;
}

async function getMe() {
  return callTelegram("getMe", {});
}

async function sendMessage({ chatId, message }) {
  return callTelegram("sendMessage", { chat_id: chatId, text: message });
}

async function sendLocation({ chatId, latitude, longitude }) {
  return callTelegram("sendLocation", {
    chat_id: chatId,
    latitude: Number(latitude),
    longitude: Number(longitude),
  });
}

async function sendPhoto({ chatId, fileName, caption, base64, latitude, longitude }) {
  if (!base64) throw new Error("base64 photo is required");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("photo is empty");
  if (bytes.length > 10 * 1024 * 1024) throw new Error("photo exceeds 10 MB MVP limit");

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", String(caption || "Samurai Camera"));
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), String(fileName || "photo.jpg"));

  const response = await fetch(`${TELEGRAM_API}/bot${token()}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.description || `Telegram HTTP ${response.status}`);
    error.code = "TELEGRAM_API_ERROR";
    error.status = response.status;
    throw error;
  }

  if (latitude != null && longitude != null) {
    await sendLocation({ chatId, latitude, longitude });
  }
  return data.result;
}

module.exports = { getMe, sendMessage, sendLocation, sendPhoto };
