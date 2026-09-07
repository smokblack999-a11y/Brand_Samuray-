"use strict";

const API = () => {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
};

async function telegram(method, payload) {
  const response = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function sendBusinessMessage({ businessConnectionId, chatId, text }) {
  return telegram("sendMessage", {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    text
  });
}

module.exports = { telegram, sendBusinessMessage };
