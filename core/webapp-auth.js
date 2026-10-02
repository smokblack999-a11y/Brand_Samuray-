"use strict";

const crypto = require("node:crypto");

const MAX_AGE_SECONDS = Math.max(60, Number(process.env.TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS || 86400));

function parseInitData(initData) {
  const params = new URLSearchParams(String(initData || ""));
  const data = {};
  for (const [key, value] of params.entries()) data[key] = value;
  return { params, data };
}

function validateInitData(initData) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const { params, data } = parseInitData(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Telegram WebApp hash missing");

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") pairs.push(key + "=" + value);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();
  const expectedHash = crypto.createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (receivedHash.length !== expectedHash.length || !crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expectedHash))) {
    throw new Error("Invalid Telegram WebApp signature");
  }

  const authDate = Number(data.auth_date || 0);
  if (!Number.isInteger(authDate) || authDate <= 0) throw new Error("Telegram WebApp auth_date missing");
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SECONDS) throw new Error("Telegram WebApp initData expired");

  let user = null;
  if (data.user) {
    try { user = JSON.parse(data.user); } catch { throw new Error("Invalid Telegram WebApp user payload"); }
  }
  if (!user?.id) throw new Error("Telegram WebApp user missing");

  return { user, authDate, queryId: data.query_id || null };
}

function requireWebAppAuth(req, res, next) {
  try {
    const initData = req.get("X-Telegram-Init-Data");
    req.telegramWebApp = validateInitData(initData);
    next();
  } catch (error) {
    res.status(401).json({ ok: false, error: { code: "INVALID_WEBAPP_AUTH", message: error.message, requestId: req.requestId } });
  }
}

module.exports = { validateInitData, requireWebAppAuth };
