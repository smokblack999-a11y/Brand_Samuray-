"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { paymentError } = require("./provider-contract");

const DATA_DIR = process.env.PAYMENTS_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "payments-ledger.json");
const ALLOWED_TRANSITIONS = Object.freeze({
  pending: new Set(["processing", "paid", "failed", "cancelled"]),
  processing: new Set(["paid", "failed", "cancelled"]),
  paid: new Set(["refunded"]),
  failed: new Set(),
  cancelled: new Set(),
  refunded: new Set()
});

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    try {
      fs.writeFileSync(FILE, JSON.stringify({ version: 1, events: {}, payments: {}, subscriptions: {} }, null, 2) + "\n", {
        flag: "wx", mode: 0o600
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

function readState() {
  ensure();
  let state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    throw paymentError("PAYMENT_LEDGER_CORRUPT", "Payment ledger cannot be parsed; refusing to overwrite it");
  }
  if (!state || state.version !== 1 || !state.events || !state.payments ||
      typeof state.events !== "object" || typeof state.payments !== "object") {
    throw paymentError("PAYMENT_LEDGER_INVALID", "Payment ledger schema is invalid; refusing to overwrite it");
  }
  if (!state.subscriptions) state.subscriptions = {};
  if (typeof state.subscriptions !== "object") {
    throw paymentError("PAYMENT_LEDGER_INVALID", "Payment ledger subscription schema is invalid");
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
  if (prefix && !result.startsWith(prefix)) {
    throw paymentError("PAYMENT_LEDGER_INPUT_INVALID", field + " has an invalid prefix");
  }
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
      if (!["completed", "failed"].includes(status)) {
        throw paymentError("PAYMENT_LEDGER_INPUT_INVALID", "Event status must be completed or failed");
      }
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
      const providerSessionId = cleanId(input.providerSessionId, "providerSessionId", "cs_");
      if (Object.values(state.payments).some(record => record.providerSessionId === providerSessionId)) {
        throw paymentError("PAYMENT_LEDGER_SESSION_DUPLICATE", "Provider Checkout Session is already linked to a payment");
      }
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
        providerSessionId,
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
      if (!Object.hasOwn(ALLOWED_TRANSITIONS, nextStatus)) {
        throw paymentError("PAYMENT_LEDGER_STATUS_INVALID", "Payment status is invalid");
      }
      const state = readState();
      const record = state.payments[id];
      if (!record) throw paymentError("PAYMENT_LEDGER_PAYMENT_NOT_FOUND", "Payment record not found");
      if (record.status === nextStatus) return record;
      if (!ALLOWED_TRANSITIONS[record.status]?.has(nextStatus)) {
        throw paymentError("PAYMENT_LEDGER_TRANSITION_INVALID", "Payment state transition is not allowed");
      }
      record.status = nextStatus;
      if (typeof providerReference === "string" && providerReference.startsWith("pi_")) {
        record.paymentIntentId = providerReference;
      }
      record.updatedAt = new Date().toISOString();
      state.payments[id] = record;
      writeState(state);
      return record;
    },

    getPayment(paymentId) {
      const state = readState();
      return state.payments[String(paymentId)] || null;
    },

    findPaymentBySession(providerSessionId) {
      const sessionId = cleanId(providerSessionId, "providerSessionId", "cs_");
      const state = readState();
      const matches = Object.values(state.payments).filter(record => record.providerSessionId === sessionId);
      if (matches.length > 1) throw paymentError("PAYMENT_LEDGER_SESSION_AMBIGUOUS", "Provider session maps to multiple payment records");
      return matches[0] || null;
    },

    createSubscription(input = {}) {
      const state = readState();
      const subscriptionId = cleanId(input.subscriptionId, "subscriptionId");
      const providerSubscriptionId = cleanId(input.providerSubscriptionId, "providerSubscriptionId", "sub_");
      if (state.subscriptions[subscriptionId] ||
          Object.values(state.subscriptions).some(record => record.providerSubscriptionId === providerSubscriptionId)) {
        throw paymentError("PAYMENT_LEDGER_SUBSCRIPTION_DUPLICATE", "Subscription is already recorded");
      }
      const initialStatus = input.status || "pending";
      if (!["pending", "incomplete", "trialing", "active", "past_due", "unpaid", "canceled", "paused"].includes(initialStatus)) {
        throw paymentError("PAYMENT_LEDGER_SUBSCRIPTION_STATUS_INVALID", "Subscription status is invalid");
      }
      const record = {
        subscriptionId,
        customerId: cleanId(input.customerId, "customerId"),
        planId: cleanId(input.planId, "planId"),
        provider: cleanId(input.provider, "provider"),
        providerSubscriptionId,
        providerCustomerId: typeof input.providerCustomerId === "string" ? input.providerCustomerId : null,
        status: initialStatus,
        lastEventCreated: Number.isSafeInteger(input.eventCreated) ? input.eventCreated : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.subscriptions[subscriptionId] = record;
      writeState(state);
      return record;
    },

    getSubscriptionByProviderId(providerSubscriptionId) {
      const id = cleanId(providerSubscriptionId, "providerSubscriptionId", "sub_");
      const state = readState();
      return Object.values(state.subscriptions).find(record => record.providerSubscriptionId === id) || null;
    },

    setSubscriptionStatus(providerSubscriptionId, nextStatus, providerCustomerId, eventCreated) {
      const id = cleanId(providerSubscriptionId, "providerSubscriptionId", "sub_");
      const allowed = new Set(["pending", "incomplete", "trialing", "active", "past_due", "unpaid", "canceled", "paused"]);
      if (!allowed.has(nextStatus)) throw paymentError("PAYMENT_LEDGER_SUBSCRIPTION_STATUS_INVALID", "Subscription status is invalid");
      const state = readState();
      const record = Object.values(state.subscriptions).find(item => item.providerSubscriptionId === id);
      if (!record) throw paymentError("PAYMENT_LEDGER_SUBSCRIPTION_NOT_FOUND", "Subscription record not found");
      const transitions = {
        pending: new Set(["incomplete", "trialing", "active", "past_due", "unpaid", "canceled"]),
        incomplete: new Set(["trialing", "active", "past_due", "unpaid", "canceled"]),
        trialing: new Set(["active", "past_due", "unpaid", "paused", "canceled"]),
        active: new Set(["past_due", "unpaid", "paused", "canceled"]),
        past_due: new Set(["active", "unpaid", "paused", "canceled"]),
        unpaid: new Set(["active", "canceled"]),
        paused: new Set(["active", "past_due", "canceled"]),
        canceled: new Set()
      };
      if (Number.isSafeInteger(eventCreated) && eventCreated < (record.lastEventCreated || 0)) return record;
      if (record.status !== nextStatus && !transitions[record.status]?.has(nextStatus)) {
        throw paymentError("PAYMENT_LEDGER_SUBSCRIPTION_TRANSITION_INVALID", "Subscription state transition is not allowed");
      }
      record.status = nextStatus;
      if (Number.isSafeInteger(eventCreated)) record.lastEventCreated = Math.max(record.lastEventCreated || 0, eventCreated);
      if (typeof providerCustomerId === "string" && providerCustomerId.startsWith("cus_")) {
        record.providerCustomerId = providerCustomerId;
      }
      record.updatedAt = new Date().toISOString();
      state.subscriptions[record.subscriptionId] = record;
      writeState(state);
      return record;
    },

    listEvents(limit = 100) {
      const state = readState();
      const max = Math.max(1, Math.min(Number(limit) || 100, 500));
      return Object.values(state.events).slice(-max).reverse();
    }
  });
}

module.exports = { createPaymentLedger };
