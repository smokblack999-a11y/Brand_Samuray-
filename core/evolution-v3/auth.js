"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 256;

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
async function hashPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw Object.assign(new Error("password_policy_violation"), { code: "PASSWORD_POLICY" });
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    if (salt.length !== 16 || expected.length !== KEYLEN) return false;
    const actual = Buffer.from(await scrypt(password, salt, KEYLEN, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
function issueSessionToken({ subject, secret, ttlSeconds = 900, now = Math.floor(Date.now() / 1000), issuer = "samurai-evolution-v3" }) {
  if (!subject || typeof subject !== "string") throw new Error("subject_required");
  if (!secret || String(secret).length < 32) throw new Error("session_secret_must_be_at_least_32_chars");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) throw new Error("invalid_ttl");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: subject, iss: issuer, iat: now, exp: now + ttlSeconds }));
  const data = header + "." + payload;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return data + "." + signature;
}
function verifySessionToken(token, { secret, now = Math.floor(Date.now() / 1000), issuer = "samurai-evolution-v3" }) {
  if (!secret || String(secret).length < 32 || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = parts[0] + "." + parts[1];
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (!safeEqual(expected, parts[2])) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    if (payload.iss !== issuer || typeof payload.sub !== "string") return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= now || !Number.isInteger(payload.iat) || payload.iat > now + 60) return null;
    return { subject: payload.sub, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    return null;
  }
}
module.exports = { hashPassword, verifyPassword, issueSessionToken, verifySessionToken };
