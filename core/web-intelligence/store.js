"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeEvidence } = require("./index");

const STORE_VERSION = 1;
const DEFAULT_MAX_RECORDS = 200;

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createLocalStore(options = {}) {
  if (!options.filePath || typeof options.filePath !== "string") {
    throw storeError("STORE_PATH_REQUIRED", "An explicit local filePath is required");
  }
  const filePath = path.resolve(options.filePath);
  const maxRecords = Number.isSafeInteger(options.maxRecords) && options.maxRecords > 0
    ? Math.min(options.maxRecords, 5000)
    : DEFAULT_MAX_RECORDS;

  function readState() {
    if (!fs.existsSync(filePath)) return { version: STORE_VERSION, records: [] };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      throw storeError("STORE_CORRUPT", "Local evidence store is not valid JSON; refusing to overwrite it");
    }
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.records)) {
      throw storeError("STORE_SCHEMA_UNSUPPORTED", "Local evidence store has an unsupported schema");
    }
    return parsed;
  }

  function writeState(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tempPath = filePath + "." + crypto.randomUUID() + ".tmp";
    try {
      fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + "\\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(tempPath, filePath);
      try { fs.chmodSync(filePath, 0o600); } catch {}
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  return Object.freeze({
    add(input) {
      const record = normalizeEvidence(input);
      const state = readState();
      const existing = state.records.find(item => item.evidenceHash === record.evidenceHash);
      if (existing) return { record: existing, duplicate: true, count: state.records.length };
      state.records.unshift(record);
      state.records = state.records.slice(0, maxRecords);
      writeState(state);
      return { record, duplicate: false, count: state.records.length };
    },
    list(limit = maxRecords) {
      const safeLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0
        ? Math.min(Number(limit), maxRecords)
        : maxRecords;
      return readState().records.slice(0, safeLimit);
    },
    getById(id) {
      return readState().records.find(item => item.id === id) || null;
    },
    count() {
      return readState().records.length;
    }
  });
}

module.exports = { createLocalStore, STORE_VERSION, DEFAULT_MAX_RECORDS };
