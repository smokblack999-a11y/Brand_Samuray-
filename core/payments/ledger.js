"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { paymentError } = require("./provider-contract");

const DATA_DIR = process.env.PAYMENTS_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "payments-ledger.json");
const TERMINAL = new Set(["paid", "failed", "cancelled", "refunded"]);

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    try { fs.writeFileSync(FILE, JSON.stringify({ version: 1, events: {}, payments: {} }, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
}

function readState() {
  ensure();
  let state;
  try { state = JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { throw paymentError("PAYMENT_LEDGER_CORRUPT", "Payment ledger cannot be parsed; refusing to overwrite it"); }
  if (!state || state.version !== 1 || !state.events || !state.payments || typeof state.events !== "object" || typeof state.payments !== "object") {
    throw paymentError("PAYMENT_LEDGER_INVALID", "Payment ledger schema is invalid; refusing to overwrite it");
  }
  return state;
}

function writeState(state) {
  ensure();
  const temp = FILE + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, FILE);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
  }
}

function cleanId(value, field, prefix) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw paymentError("PAYMENT_LEDGER_INPUT_INVALID", field + " is required");
  }
  const result = value.trim();
  if (prefix && !result.startsWith(prefix)) throw paymentError("PAYMENT_LEDGER_INPUT_INVALID", field + " has an invalid prefix");
  return result;
}

function createPaymentLedger() {
  return Object.freeze({
    claimEvent(eventId, eventType, objectId) {
      const id = cleanId(eventId, "eventId", "evt_");
      const type = cleanId(eventType, "eventType");
      const state = readState();
      const current = state.events[id];
      if (current && current.status !== "failed") return { claimed: false, event: current };
      const event = current || { eventId: id, createdAt: new Date().toISOString(), attempts: 0 };
      event.type = type;
      event.objectId = typeof objectId === "string" ? objectId.slice(0, 200) : null;
      event.status = "processing";
      event.attempts += 1;
      event.updatedAt = new Date().toISOString();
      delete event.errorCode;
      state.events[id] = event;
      writeState(state);
      return { claimed: true, event };
    },

    markEvent(eventId, status, errorCode) {
      const id = cleanId(eventId, "eventId", "evt_");
      if (!["completed", "failed"].includes(status)) throw paymentError("PAYMENT_LEDGER_INPUT_INVALID", "Event status must be completed or failed");
      const state = readState();
      const event = state.events[id];
      if (!event) throw paymentError("PAYMENT_LEDGER_EVENT_NOT_FOUND", "Webhook event was not claimed");
      event.status = status;
      event.updatedAt = new Date().toISOString();
      if (status === "failed" && typeof errorCode === "string") event.errorCode = errorCode.slice(0, 80);
      else delete event.errorCode;
      writeState(state);
      return event;
    },

    createPayment(input = {}) {
      const paymentId = cleanId(input.paymentId, "paymentId");
      const state = readState();
      if (state.payments[paymentId]) throw paymentError("PAYMENT_LEDGER_DUPLICATE", "Payment record already exists");
      const amountMinor = input.amountMinor;
      const currency = cleanId(input.currency, "currency").toLowerCase();
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || !/^[a-z]{3}$/.test(currency)) {
        throw paymentError("PAYMENT_LEDGER_INPUT_INVALID", "Payment amount or currency is invalid");
      }
      const record = {
        paymentId,
        orderId: cleanId(input.orderId, "orderId"),
        customerId: cleanId(input.customerId, "customerId"),
        provider: cleanId(input.provider, "provider"),
        providerSessionId: cleanId(input.providerSessionId, "providerSessionId", "cs_"),
        amountMinor,
        currency,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.payments[paymentId] = record;
      writeState(state);
      return record;
    },

    setPaymentStatus(paymentId, nextStatus, providerReference) {
      const id = cleanId(paymentId, "paymentId");
      if (!["processing", "paid", "failed", "cancelled", "refunded"].includes(nextStatus)) {
        throw paymentError("PAYMENT_LEDGER_STATUS_INVALID", "Payment status is invalid");
      }
      const state = readState();
      const record = state.payments[id];
      if (!record) throw paymentError("PAYMENT_LEDGER_PAYMENT_NOT_FOUND", "Payment record not found");
      if (record.status === nextStatus) return record;
      if (TERMINAL.has(record.status)) throw paymentError("PAYMENT_LEDGER_TRANSITION_INVALID", "Terminal payment state cannot be changed");
      record.status = nextStatus;
      if (typeof providerReference === "string" && providerReference.startsWith("pi_")) record.paymentIntentId = providerReference;
      record.updatedAt = new Date().toISOString();
      state.payments[id] = record;
      writeState(state);
      return record;
    },

    getPayment(paymentId) {
      const state = readState();
      return state.payments[String(paymentId)] || null;
    },

    listEvents(limit = 100) {
      const state = readState();
      const max = Math.max(1, Math.min(Number(limit) || 100, 500));
      return Object.values(state.events).slice(-max).reverse();
    }
  });
}

module.exports = { createPaymentLedger };
