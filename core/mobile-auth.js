"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "mobile-tokens.json");
const ENROLLMENT_SECRET = String(process.env.MOBILE_ENROLLMENT_SECRET || "").trim();
const TOKEN_TTL_MS = Math.max(5 * 60_000, Number(process.env.MOBILE_TOKEN_TTL_MS || 24 * 60 * 60_000));
const MAX_TOKENS = Math.max(1, Number(process.env.MOBILE_MAX_TOKENS || 20));

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n", { mode: 0o600 });
}
function read() {
  ensure();
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return []; }
}
function write(rows) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
function digest(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
function issue(deviceName = "android") {
  if (!ENROLLMENT_SECRET) {
    const e = new Error("Mobile enrollment is not configured");
    e.code = "MOBILE_ENROLLMENT_NOT_CONFIGURED";
    throw e;
  }
  const rows = read().filter(x => x.expiresAt > Date.now());
  if (rows.length >= MAX_TOKENS) {
    const e = new Error("Mobile device limit reached");
    e.code = "MOBILE_DEVICE_LIMIT";
    throw e;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  rows.push({ tokenHash: digest(token), deviceName: String(deviceName).slice(0, 80), createdAt: Date.now(), expiresAt: Date.now() + TOKEN_TTL_MS });
  write(rows);
  return { token, expiresAt: Date.now() + TOKEN_TTL_MS };
}
function enroll(secret, deviceName) {
  const expected = Buffer.from(ENROLLMENT_SECRET);
  const actual = Buffer.from(String(secret || ""));
  if (!ENROLLMENT_SECRET || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const e = new Error("Invalid enrollment secret");
    e.code = "INVALID_ENROLLMENT_SECRET";
    throw e;
  }
  return issue(deviceName);
}
function verify(token) {
  if (!token) return false;
  const now = Date.now();
  return read().some(x => x.expiresAt > now && x.tokenHash === digest(token));
}
function revokeAll() {
  write([]);
}
module.exports = { enroll, verify, revokeAll };
