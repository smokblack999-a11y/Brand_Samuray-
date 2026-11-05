"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const GENESIS = "0".repeat(64);
const HASH = /^[a-f0-9]{64}$/i;
const queues = new Map();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function entryHash(entry) {
  return sha256(JSON.stringify({
    sequence: entry.sequence,
    previousHash: entry.previousHash,
    receiptHash: entry.receiptHash,
    receipt: entry.receipt
  }));
}

async function readEntries(filePath) {
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!source.trim()) return [];
  return source.split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error("hard988_ledger_invalid_json_at_line_" + (index + 1));
    }
  });
}

async function verifyLedger(filePath) {
  const entries = await readEntries(filePath);
  let previousHash = GENESIS;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.sequence !== index + 1) {
      return { valid: false, entries: entries.length, reason: "sequence_mismatch", failedAt: index + 1 };
    }
    if (entry.previousHash !== previousHash) {
      return { valid: false, entries: entries.length, reason: "previous_hash_mismatch", failedAt: index + 1 };
    }
    if (!HASH.test(String(entry.receiptHash || "")) ||
        entry.receiptHash !== entry.receipt?.receiptHash ||
        !HASH.test(String(entry.entryHash || "")) ||
        entry.entryHash !== entryHash(entry)) {
      return { valid: false, entries: entries.length, reason: "entry_hash_mismatch", failedAt: index + 1 };
    }
    previousHash = entry.entryHash;
  }
  return { valid: true, entries: entries.length, headHash: previousHash };
}

async function appendReceipt(filePath, receipt) {
  if (!filePath || typeof filePath !== "string") throw new Error("hard988_ledger_path_required");
  if (!receipt || typeof receipt !== "object" || !HASH.test(String(receipt.receiptHash || ""))) {
    throw new Error("hard988_receipt_invalid");
  }

  const target = path.resolve(filePath);
  const prior = queues.get(target) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const queued = prior.then(() => current);
  queues.set(target, queued);
  await prior;

  try {
    const state = await verifyLedger(target);
    if (!state.valid) throw new Error("hard988_ledger_corrupt:" + state.reason);
    const entries = await readEntries(target);
    const body = {
      sequence: entries.length + 1,
      previousHash: entries.length ? entries[entries.length - 1].entryHash : GENESIS,
      receiptHash: receipt.receiptHash,
      receipt
    };
    const entry = { ...body, entryHash: entryHash(body) };
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
    return entry;
  } finally {
    release();
    if (queues.get(target) === queued) queues.delete(target);
  }
}

module.exports = { appendReceipt, verifyLedger };
