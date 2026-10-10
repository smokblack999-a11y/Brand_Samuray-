"use strict";

require("dotenv").config({ path: process.env.TELEGRAM_CORE_ENV_FILE || ".env" });

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { createSessionStore, keyFromEnv } = require("./session-store");
const { createTelegramService } = require("./telegram-service");

const PORT = Math.max(1, Math.min(65535, Number(process.env.TELEGRAM_CORE_PORT || 8790)));
const HOST = process.env.TELEGRAM_CORE_HOST || "127.0.0.1";
const API_KEY = String(process.env.TELEGRAM_CORE_API_KEY || "");
const SESSION_KEY = process.env.TELEGRAM_SESSION_KEY;
const SESSION_FILE = path.resolve(process.env.TELEGRAM_SESSION_FILE || "./data/telegram-session.enc");
const MEDIA_ROOT = path.resolve(process.env.TELEGRAM_MEDIA_ROOT || "./media");
const MAX_JSON_BYTES = "1mb";

if (!API_KEY || API_KEY.length < 32) throw new Error("TELEGRAM_CORE_API_KEY must be at least 32 characters");
const sessionStore = createSessionStore({ filePath: SESSION_FILE, key: keyFromEnv(SESSION_KEY) });
const telegram = createTelegramService({
  apiId: process.env.TELEGRAM_API_ID,
  apiHash: process.env.TELEGRAM_API_HASH,
  sessionStore
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: MAX_JSON_BYTES, strict: true }));

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function requireApiKey(req, res, next) {
  const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(API_KEY, supplied)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function boundedLimit(value, fallback = 30) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : fallback;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "telegram-core", accountClient: "MTProto" }));
app.use("/v1", requireApiKey);

app.post("/v1/auth/code", asyncRoute(async (req, res) => {
  const result = await telegram.requestCode(req.body?.phoneNumber);
  res.json({ ok: true, ...result });
}));
app.post("/v1/auth/verify", asyncRoute(async (req, res) => {
  const result = await telegram.verifyCode({
    phoneNumber: req.body?.phoneNumber,
    phoneCodeHash: req.body?.phoneCodeHash,
    phoneCode: req.body?.phoneCode
  });
  res.json({ ok: true, ...result });
}));
app.post("/v1/auth/password", asyncRoute(async (req, res) => {
  if (typeof req.body?.password !== "string" || !req.body.password) return res.status(400).json({ ok: false, error: "PASSWORD_REQUIRED" });
  res.json({ ok: true, ...await telegram.verifyPassword(req.body.password) });
}));
app.get("/v1/me", asyncRoute(async (_req, res) => res.json({ ok: true, account: await telegram.getMe() })));
app.get("/v1/chats", asyncRoute(async (req, res) => res.json({ ok: true, chats: await telegram.getChats(boundedLimit(req.query.limit)) })));
app.get("/v1/chats/:chatId/messages", asyncRoute(async (req, res) => res.json({ ok: true, messages: await telegram.getMessages(req.params.chatId, boundedLimit(req.query.limit)) })));
app.post("/v1/messages", asyncRoute(async (req, res) => {
  res.status(201).json({ ok: true, message: await telegram.sendMessage({ chatId: req.body?.chatId, text: req.body?.text }) });
}));
app.post("/v1/media/photo", asyncRoute(async (req, res) => {
  const { chatId, fileName, caption = "" } = req.body || {};
  if (typeof fileName !== "string" || !fileName || fileName.includes("\\") || fileName.includes("/") || fileName.includes("..")) {
    return res.status(400).json({ ok: false, error: "INVALID_FILE_NAME" });
  }
  const root = fs.realpathSync(MEDIA_ROOT);
  const candidate = path.resolve(root, fileName);
  if (!candidate.startsWith(root + path.sep)) return res.status(400).json({ ok: false, error: "INVALID_MEDIA_PATH" });
  const actual = fs.realpathSync(candidate);
  if (!actual.startsWith(root + path.sep) || !fs.statSync(actual).isFile()) return res.status(400).json({ ok: false, error: "INVALID_MEDIA_FILE" });
  if (!/\.(jpe?g|png|webp)$/i.test(actual)) return res.status(415).json({ ok: false, error: "UNSUPPORTED_IMAGE_TYPE" });
  res.status(201).json({ ok: true, message: await telegram.sendPhoto({ chatId, filePath: actual, caption }) });
}));
app.post("/v1/logout", asyncRoute(async (_req, res) => res.json({ ok: true, ...await telegram.logout() })));

app.use((err, _req, res, _next) => {
  const message = String(err?.message || "Internal error");
  const status = /required|must be|invalid|expired|not authorized|already pending|no matching/i.test(message) ? 400 : 502;
  // Do not return stack traces, credentials, or Telegram session material to callers.
  res.status(status).json({ ok: false, error: status === 400 ? "INVALID_REQUEST" : "TELEGRAM_UPSTREAM_ERROR", message: message.slice(0, 240) });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`telegram-core listening on http://${HOST}:${PORT}`);
});

async function shutdown(signal) {
  console.log(`telegram-core received ${signal}; shutting down`);
  server.close(async () => {
    await telegram.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
