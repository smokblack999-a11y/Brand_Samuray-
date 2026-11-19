"use strict";
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest();
}
function validateUsername(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_]{3,32}$/.test(value);
}
function validatePassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
function validateCiphertext(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 1400000) return false;
  try { return Buffer.from(value, "base64").length >= 12; } catch { return false; }
}
async function hashPassword(password) {
  if (!validatePassword(password)) throw Object.assign(new Error("Password must be 12-128 characters"), { status: 400, code: "INVALID_PASSWORD" });
  return bcrypt.hash(password, 12);
}
async function verifyPassword(password, encoded) {
  return bcrypt.compare(String(password || ""), String(encoded || ""));
}
function issueAccessToken(user, secret) {
  return jwt.sign({ sub: user.id, username: user.username, typ: "access" }, secret, { expiresIn: "15m", issuer: "samurai-messenger" });
}
function verifyAccessToken(token, secret) {
  const payload = jwt.verify(token, secret, { issuer: "samurai-messenger" });
  if (payload.typ !== "access" || typeof payload.sub !== "string") throw new Error("Invalid access token");
  return payload;
}
function newRefreshToken() { return crypto.randomBytes(48).toString("base64url"); }
module.exports = { hashToken, validateUsername, validatePassword, validateCiphertext, hashPassword, verifyPassword, issueAccessToken, verifyAccessToken, newRefreshToken };
