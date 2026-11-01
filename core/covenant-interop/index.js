"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const VERSION = "1.0";
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_ENVELOPE_BYTES = 16 * 1024;
const ALLOWED_INTENTS = new Set([
  "submit_gradient_update",
  "observe_round",
  "lead.intent.detected",
  "agent.task.proposed",
  "agent.audit.receipt",
  "contribution.evidence.recorded"
]);
const ALLOWED_PERFORMATIVES = new Set(["inform", "propose", "confirm", "refuse"]);
const ENVELOPE_KEYS = new Set([
  "version", "message_id", "intent", "from_ai", "to_ai",
  "message_type", "performative", "timestamp", "payload", "signature"
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    fail("COVENANT_SECRET_TOO_SHORT");
  }
}

function canonicalJson(value, depth = 0) {
  if (depth > 8) fail("COVENANT_PAYLOAD_TOO_DEEP");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("COVENANT_PAYLOAD_INVALID_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 200) fail("COVENANT_PAYLOAD_TOO_LARGE");
    return "[" + value.map(item => canonicalJson(item, depth + 1)).join(",") + "]";
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail("COVENANT_PAYLOAD_INVALID_OBJECT");
    const keys = Object.keys(value).sort();
    if (keys.length > 100) fail("COVENANT_PAYLOAD_TOO_LARGE");
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key) || key.length > 80) fail("COVENANT_PAYLOAD_INVALID_KEY");
    }
    return "{" + keys.map(key => JSON.stringify(key) + ":" + canonicalJson(value[key], depth + 1)).join(",") + "}";
  }
  fail("COVENANT_PAYLOAD_INVALID_VALUE");
}

function validateCore(envelope, { now = Date.now(), maxClockSkewSeconds = MAX_CLOCK_SKEW_SECONDS } = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    fail("COVENANT_ENVELOPE_INVALID");
  }
  const proto = Object.getPrototypeOf(envelope);
  if (proto !== Object.prototype && proto !== null) fail("COVENANT_ENVELOPE_INVALID");

  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.has(key)) fail("COVENANT_ENVELOPE_UNSUPPORTED_FIELD");
  }
  if (envelope.version !== VERSION) fail("COVENANT_VERSION_UNSUPPORTED");
  if (typeof envelope.message_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(envelope.message_id)) {
    fail("COVENANT_MESSAGE_ID_INVALID");
  }
  if (typeof envelope.intent !== "string" || !ALLOWED_INTENTS.has(envelope.intent)) {
    fail("COVENANT_INTENT_NOT_ALLOWED");
  }
  for (const field of ["from_ai", "to_ai"]) {
    if (typeof envelope[field] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(envelope[field])) {
      fail("COVENANT_PARTICIPANT_INVALID");
    }
  }
  if (typeof envelope.message_type !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(envelope.message_type)) {
    fail("COVENANT_MESSAGE_TYPE_INVALID");
  }
  if (!ALLOWED_PERFORMATIVES.has(envelope.performative)) fail("COVENANT_PERFORMATIVE_NOT_ALLOWED");
  if (!Number.isSafeInteger(envelope.timestamp) || envelope.timestamp <= 0) {
    fail("COVENANT_TIMESTAMP_INVALID");
  }
  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - envelope.timestamp) > maxClockSkewSeconds) {
    fail("COVENANT_TIMESTAMP_OUT_OF_RANGE");
  }
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    fail("COVENANT_PAYLOAD_INVALID");
  }
  const payloadJson = canonicalJson(envelope.payload);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_ENVELOPE_BYTES) fail("COVENANT_PAYLOAD_TOO_LARGE");
}

function unsignedEnvelope(envelope) {
  const result = {};
  for (const key of Object.keys(envelope)) {
    if (key !== "signature") result[key] = envelope[key];
  }
  return result;
}

function sign(unsigned, secret) {
  return crypto.createHmac("sha256", secret).update(canonicalJson(unsigned), "utf8").digest("hex");
}

function safeHexEqual(expected, actual) {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createEnvelope(input = {}, { secret, now = Date.now() } = {}) {
  requireSecret(secret);
  const envelope = {
    version: VERSION,
    message_id: input.message_id || crypto.randomUUID(),
    intent: input.intent,
    from_ai: input.from_ai,
    to_ai: input.to_ai,
    message_type: input.message_type || "event",
    performative: input.performative || "inform",
    timestamp: input.timestamp === undefined ? Math.floor(now / 1000) : input.timestamp,
    payload: input.payload === undefined ? {} : input.payload
  };
  validateCore(envelope, { now });
  const signature = sign(envelope, secret);
  return Object.freeze({ ...envelope, signature });
}

function verifyEnvelope(envelope, { secret, now = Date.now(), maxClockSkewSeconds = MAX_CLOCK_SKEW_SECONDS } = {}) {
  requireSecret(secret);
  validateCore(envelope, { now, maxClockSkewSeconds });
  if (typeof envelope.signature !== "string" || !safeHexEqual(sign(unsignedEnvelope(envelope), secret), envelope.signature)) {
    fail("COVENANT_SIGNATURE_INVALID");
  }
  const canonical = canonicalJson(unsignedEnvelope(envelope));
  return {
    messageId: envelope.message_id,
    intent: envelope.intent,
    fromAI: envelope.from_ai,
    toAI: envelope.to_ai,
    timestamp: envelope.timestamp,
    bodySha256: crypto.createHash("sha256").update(canonical, "utf8").digest("hex")
  };
}

class CovenantEventStore {
  constructor(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) fail("COVENANT_STORE_PATH_REQUIRED");
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const fd = fs.openSync(this.filePath, "wx", 0o600);
      fs.closeSync(fd);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    fs.chmodSync(this.filePath, 0o600);
    this.events = [];
    this.byMessageId = new Map();
    this._load();
  }

  _load() {
    const text = fs.readFileSync(this.filePath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch (_error) {
        fail("COVENANT_STORE_CORRUPT");
      }
      if (
        !record ||
        typeof record.accepted_at !== "string" ||
        typeof record.body_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.body_sha256) ||
        !record.message ||
        typeof record.message.message_id !== "string" ||
        this.byMessageId.has(record.message.message_id)
      ) {
        fail("COVENANT_STORE_CORRUPT");
      }
      this.events.push(record);
      this.byMessageId.set(record.message.message_id, record);
    }
  }

  accept(envelope, { secret, now = Date.now(), maxClockSkewSeconds = MAX_CLOCK_SKEW_SECONDS } = {}) {
    const verified = verifyEnvelope(envelope, { secret, now, maxClockSkewSeconds });
    const existing = this.byMessageId.get(verified.messageId);
    if (existing) {
      if (existing.body_sha256 !== verified.bodySha256) fail("COVENANT_MESSAGE_ID_CONFLICT");
      return { accepted: false, duplicate: true, event: this._summary(existing) };
    }

    const record = {
      accepted_at: new Date(now).toISOString(),
      body_sha256: verified.bodySha256,
      message: JSON.parse(JSON.stringify(envelope))
    };
    const line = JSON.stringify(record) + "\n";
    let fd;
    try {
      fd = fs.openSync(this.filePath, "a", 0o600);
      fs.writeSync(fd, line, null, "utf8");
      fs.fsyncSync(fd);
    } catch (_error) {
      fail("COVENANT_STORE_WRITE_FAILED");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    this.events.push(record);
    this.byMessageId.set(verified.messageId, record);
    return { accepted: true, duplicate: false, event: this._summary(record) };
  }

  _summary(record) {
    const message = record.message;
    return {
      message_id: message.message_id,
      intent: message.intent,
      from_ai: message.from_ai,
      to_ai: message.to_ai,
      timestamp: message.timestamp,
      accepted_at: record.accepted_at,
      body_sha256: record.body_sha256
    };
  }

  list(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    return this.events.slice(-safeLimit).reverse().map(record => this._summary(record));
  }

  health() {
    return { ok: true, storedEvents: this.events.length, storage: "local-jsonl-fsync" };
  }
}

module.exports = {
  VERSION,
  MAX_CLOCK_SKEW_SECONDS,
  MAX_ENVELOPE_BYTES,
  ALLOWED_INTENTS,
  createEnvelope,
  verifyEnvelope,
  CovenantEventStore
};
