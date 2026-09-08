"use strict";

const TELEGRAM_TIMEOUT_MS = Math.max(1000, Number(process.env.TELEGRAM_TIMEOUT_MS || 10000));

const API = () => {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
};

async function telegram(method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${API()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
    return data.result;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Telegram ${method} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendBusinessMessage({ businessConnectionId, chatId, text }) {
  const cleanText = String(text || "").trim();
  if (!businessConnectionId || !chatId || !cleanText) throw new Error("businessConnectionId, chatId and text are required");
  return telegram("sendMessage", {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    text: cleanText.slice(0, 4096)
  });
}

module.exports = { telegram, sendBusinessMessage };
