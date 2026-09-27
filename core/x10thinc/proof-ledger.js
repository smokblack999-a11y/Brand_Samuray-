"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = process.env.NEXUS_LEDGER_PATH
  ? path.resolve(process.env.NEXUS_LEDGER_PATH)
  : path.join(DATA_DIR, "proof-ledger.jsonl");
const REDACTION = "[REDACTED]";

function redact(value) {
  return JSON.parse(String(value ?? "{}")
    .replace(/(authorization|api[-_ ]?key|token|secret|password|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1:"+REDACTION)
    .replace(/sk-(?:proj|svcacct)-[A-Za-z0-9_-]+/g, REDACTION));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function readLines() {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, "utf8").split(/\r?\n/).filter(Boolean);
}

function lastHash() {
  const lines = readLines();
  if (!lines.length) return "GENESIS";
  try { return JSON.parse(lines[lines.length - 1]).recordHash || "GENESIS"; }
  catch { return "INVALID"; }
}

function append(receipt) {
  if (!receipt || typeof receipt !== "object") throw new Error("PROOF_RECEIPT_REQUIRED");
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const data = redact(JSON.stringify(receipt));
  const record = {
    version: "x10thinc-proof-ledger-v1",
    ts: new Date().toISOString(),
    prevHash: lastHash(),
    receipt: data
  };
  record.recordHash = digest(record);
  fs.appendFileSync(FILE, JSON.stringify(record) + "\n", { mode: 0o600 });
  return record;
}

function verify() {
  const lines = readLines();
  let previous = "GENESIS";
  for (let i = 0; i < lines.length; i++) {
    let record;
    try { record = JSON.parse(lines[i]); } catch {
      return { passed: false, index: i, reason: "LEDGER_JSON_INVALID" };
    }
    if (record.prevHash !== previous) return { passed: false, index: i, reason: "LEDGER_PREV_HASH_MISMATCH" };
    const supplied = record.recordHash;
    const copy = { ...record };
    delete copy.recordHash;
    if (digest(copy) !== supplied) return { passed: false, index: i, reason: "LEDGER_RECORD_HASH_MISMATCH" };
    previous = supplied;
  }
  return { passed: true, records: lines.length, lastHash: previous, file: FILE };
}

module.exports = { FILE, append, verify, lastHash };
