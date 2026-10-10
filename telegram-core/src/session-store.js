"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function keyFromEnv(value) {
  if (!value) throw new Error("TELEGRAM_SESSION_KEY is required");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("TELEGRAM_SESSION_KEY must be base64 for exactly 32 random bytes");
  return key;
}

function createSessionStore({ filePath, key }) {
  if (!filePath) throw new Error("session file path is required");
  const resolved = path.resolve(filePath);
  const encryptionKey = Buffer.isBuffer(key) ? key : keyFromEnv(key);

  function save(session) {
    if (typeof session !== "string" || session.length < 10) throw new Error("invalid Telegram session");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(session, "utf8"), cipher.final()]);
    const payload = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    const temp = resolved + "." + crypto.randomUUID() + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, resolved);
    try { fs.chmodSync(resolved, 0o600); } catch (_) {}
  }

  function load() {
    if (!fs.existsSync(resolved)) return null;
    const payload = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (payload.version !== 1 || payload.algorithm !== "aes-256-gcm") throw new Error("unsupported encrypted session format");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  function remove() {
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  }

  return Object.freeze({ save, load, remove, filePath: resolved });
}

module.exports = { createSessionStore, keyFromEnv };
