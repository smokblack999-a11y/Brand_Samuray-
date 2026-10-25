"use strict";

// Transactional persistence for order/payment state. Node 22.13+ provides node:sqlite.
// SQLite is intended for one Core instance with a persistent local volume. Do not share
// this file over a network filesystem or mount it into multiple replicas; use PostgreSQL
// before horizontal scaling.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.COMMERCE_DB_PATH || path.join(DATA_DIR, "commerce.sqlite");
const ORDERS_FILE = path.join(DATA_DIR, "commerce-orders.json");
const EVENTS_FILE = path.join(DATA_DIR, "commerce-payment-events.json");
const SESSIONS_FILE = path.join(DATA_DIR, "commerce-bot-sessions.json");
const UPDATES_FILE = path.join(DATA_DIR, "commerce-bot-updates.json");
const MIGRATION_NAME = "001_legacy_commerce_json_to_sqlite";
const TELEGRAM_MIGRATION_NAME = "002_legacy_telegram_state_to_sqlite";

if (DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true, mode: 0o700 });
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = FULL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS commerce_orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    idempotency_key TEXT,
    status TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_commerce_orders_customer_created
    ON commerce_orders(customer_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_commerce_orders_status
    ON commerce_orders(status, payment_status);
  CREATE INDEX IF NOT EXISTS idx_commerce_orders_idempotency
    ON commerce_orders(idempotency_key);

  CREATE TABLE IF NOT EXISTS commerce_payment_events (
    event_id TEXT PRIMARY KEY,
    order_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_commerce_payment_events_order
    ON commerce_payment_events(order_id);

  CREATE TABLE IF NOT EXISTS commerce_outbox_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    order_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'PROCESSING', 'RETRY', 'SENT')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_until TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_commerce_outbox_due
    ON commerce_outbox_jobs(status, available_at, lease_until);

  CREATE TABLE IF NOT EXISTS commerce_bot_sessions (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commerce_telegram_updates (
    update_id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commerce_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

let transactionDepth = 0;

function withTransaction(fn) {
  if (typeof fn !== "function") throw new TypeError("Transaction callback is required");
  // Synchronous callbacks only: no network requests or await inside a DB transaction.
  if (transactionDepth > 0) return fn();
  db.exec("BEGIN IMMEDIATE;");
  transactionDepth = 1;
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      throw new TypeError("SQLite transaction callbacks must be synchronous");
    }
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  } finally {
    transactionDepth = 0;
  }
}

const upsertOrderStatement = db.prepare(`
  INSERT INTO commerce_orders
    (id, customer_id, idempotency_key, status, payment_status, created_at, updated_at, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    customer_id = excluded.customer_id,
    idempotency_key = excluded.idempotency_key,
    status = excluded.status,
    payment_status = excluded.payment_status,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    payload = excluded.payload
`);

function upsertOrder(order) {
  if (!order || typeof order !== "object" || !String(order.id || "").trim()) {
    throw new Error("Cannot persist an order without an ID");
  }
  const now = new Date().toISOString();
  const createdAt = String(order.createdAt || now);
  const updatedAt = String(order.updatedAt || createdAt);
  const payload = { ...order, createdAt, updatedAt };
  upsertOrderStatement.run(
    String(order.id),
    String(order.customerId || ""),
    String(order.idempotencyKey || "") || null,
    String(order.status || "AWAITING_PAYMENT"),
    String(order.paymentStatus || "AWAITING_PAYMENT"),
    createdAt,
    updatedAt,
    JSON.stringify(payload)
  );
}

function readOrders() {
  return db.prepare("SELECT payload FROM commerce_orders ORDER BY rowid").all()
    .map((row) => JSON.parse(row.payload));
}

function writeOrders(orders) {
  if (!Array.isArray(orders)) throw new TypeError("Orders must be an array");
  return withTransaction(() => {
    for (const order of orders) upsertOrder(order);
  });
}

function readEvents() {
  return db.prepare("SELECT event_id FROM commerce_payment_events ORDER BY created_at, event_id")
    .all().map((row) => row.event_id);
}

function writeEvents(events) {
  if (!Array.isArray(events)) throw new TypeError("Payment events must be an array");
  return withTransaction(() => {
    const orders = readOrders();
    const statement = db.prepare(`
      INSERT INTO commerce_payment_events(event_id, order_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `);
    const now = new Date().toISOString();
    for (const eventId of new Set(events.map((value) => String(value || "").trim()).filter(Boolean))) {
      const order = orders.find((item) =>
        (Array.isArray(item.paymentEventIds) && item.paymentEventIds.includes(eventId)) ||
        item.paymentReference === eventId
      );
      statement.run(eventId, order?.id || null, now);
    }
  });
}

function readLegacyJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    throw new Error("Legacy commerce file is invalid JSON and was not imported: " + path.basename(file), { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error("Legacy commerce file must contain a JSON array: " + path.basename(file));
  return parsed;
}

function readLegacyObject(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    throw new Error("Legacy state file is invalid JSON and was not imported: " + path.basename(file), { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Legacy state file must contain a JSON object: " + path.basename(file));
  }
  return parsed;
}

function migrateLegacyJsonOnce() {
  if (db.prepare("SELECT name FROM commerce_schema_migrations WHERE name = ?").get(MIGRATION_NAME)) return;

  const legacyOrders = readLegacyJson(ORDERS_FILE, []);
  const legacyEvents = readLegacyJson(EVENTS_FILE, []);
  withTransaction(() => {
    for (const order of legacyOrders) upsertOrder(order);
    const eventStatement = db.prepare(`
      INSERT INTO commerce_payment_events(event_id, order_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `);
    const now = new Date().toISOString();
    for (const value of new Set(legacyEvents.map((eventId) => String(eventId || "").trim()).filter(Boolean))) {
      const order = legacyOrders.find((item) =>
        (Array.isArray(item.paymentEventIds) && item.paymentEventIds.includes(value)) ||
        item.paymentReference === value
      );
      eventStatement.run(value, order?.id || null, now);
    }
    db.prepare("INSERT INTO commerce_schema_migrations(name, applied_at) VALUES (?, ?)")
      .run(MIGRATION_NAME, now);
  });
}

function migrateLegacyTelegramStateOnce() {
  if (db.prepare("SELECT name FROM commerce_schema_migrations WHERE name = ?").get(TELEGRAM_MIGRATION_NAME)) return;

  const legacySessions = readLegacyObject(SESSIONS_FILE, {});
  const legacyUpdateIds = readLegacyJson(UPDATES_FILE, []);
  withTransaction(() => {
    const sessionStatement = db.prepare(`
      INSERT INTO commerce_bot_sessions(user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING
    `);
    const now = new Date().toISOString();
    for (const [userId, payload] of Object.entries(legacySessions)) {
      if (!String(userId).trim() || payload == null) continue;
      sessionStatement.run(String(userId), JSON.stringify(payload), now);
    }
    const updateStatement = db.prepare(`
      INSERT INTO commerce_telegram_updates(update_id, created_at)
      VALUES (?, ?)
      ON CONFLICT(update_id) DO NOTHING
    `);
    for (const updateId of new Set(legacyUpdateIds.filter(Number.isSafeInteger))) {
      updateStatement.run(updateId, now);
    }
    db.exec(`
      DELETE FROM commerce_telegram_updates
      WHERE update_id NOT IN (
        SELECT update_id FROM commerce_telegram_updates ORDER BY update_id DESC LIMIT 10000
      )
    `);
    db.prepare("INSERT INTO commerce_schema_migrations(name, applied_at) VALUES (?, ?)")
      .run(TELEGRAM_MIGRATION_NAME, now);
  });
}

function readBotSessions() {
  const sessions = {};
  for (const row of db.prepare("SELECT user_id, payload FROM commerce_bot_sessions").all()) {
    try { sessions[row.user_id] = JSON.parse(row.payload); } catch {}
  }
  return sessions;
}

function setBotSession(userId, value) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("Telegram user ID is required for a session");
  return withTransaction(() => {
    if (value == null) {
      db.prepare("DELETE FROM commerce_bot_sessions WHERE user_id = ?").run(id);
      return;
    }
    db.prepare(`
      INSERT INTO commerce_bot_sessions(user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(id, JSON.stringify(value), new Date().toISOString());
  });
}

function hasTelegramUpdate(updateId) {
  if (!Number.isSafeInteger(updateId)) return false;
  return Boolean(db.prepare("SELECT update_id FROM commerce_telegram_updates WHERE update_id = ?").get(updateId));
}

function markTelegramUpdate(updateId) {
  if (!Number.isSafeInteger(updateId)) return false;
  return withTransaction(() => {
    db.prepare("INSERT INTO commerce_telegram_updates(update_id, created_at) VALUES (?, ?) ON CONFLICT(update_id) DO NOTHING")
      .run(updateId, new Date().toISOString());
    db.exec(`
      DELETE FROM commerce_telegram_updates
      WHERE update_id NOT IN (
        SELECT update_id FROM commerce_telegram_updates ORDER BY update_id DESC LIMIT 10000
      )
    `);
    return true;
  });
}

function enqueuePaymentNotification(orderId) {
  const id = String(orderId || "").trim();
  if (!id) throw new Error("Order ID is required for a payment notification job");
  return withTransaction(() => {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO commerce_outbox_jobs
        (dedupe_key, type, order_id, payload, status, attempts, available_at, created_at, updated_at)
      VALUES (?, 'payment_notifications', ?, ?, 'PENDING', 0, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `).run("payment-notifications:" + id, id, JSON.stringify({ orderId: id }), now, now, now);
  });
}

function claimPendingOutboxJobs(limit = 25) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
  return withTransaction(() => {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + 5 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT id, type, order_id, payload, attempts
      FROM commerce_outbox_jobs
      WHERE (status IN ('PENDING', 'RETRY') AND available_at <= ?)
         OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until <= ?)
      ORDER BY id
      LIMIT ?
    `).all(now, now, safeLimit);
    const update = db.prepare(`
      UPDATE commerce_outbox_jobs
      SET status = 'PROCESSING', attempts = attempts + 1, lease_until = ?, updated_at = ?
      WHERE id = ?
    `);
    return rows.map((row) => {
      update.run(leaseUntil, now, row.id);
      let payload = {};
      try { payload = JSON.parse(row.payload); } catch {}
      return {
        id: row.id,
        type: row.type,
        orderId: row.order_id,
        payload,
        attempts: Number(row.attempts || 0) + 1
      };
    });
  });
}

function completeOutboxJob(jobId) {
  const id = Number(jobId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE commerce_outbox_jobs
    SET status = 'SENT', lease_until = NULL, last_error_code = NULL,
        processed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
  return result.changes === 1;
}

function retryOutboxJob(jobId, errorCode = "NOTIFICATION_FAILED") {
  const id = Number(jobId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const row = db.prepare("SELECT attempts FROM commerce_outbox_jobs WHERE id = ?").get(id);
  if (!row) return false;
  const attempts = Math.max(1, Number(row.attempts || 0));
  const delayMs = Math.min(1000 * (2 ** Math.min(attempts, 10)), 15 * 60 * 1000);
  const nowMs = Date.now();
  const safeCode = String(errorCode || "NOTIFICATION_FAILED").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  const result = db.prepare(`
    UPDATE commerce_outbox_jobs
    SET status = 'RETRY', available_at = ?, lease_until = NULL,
        last_error_code = ?, updated_at = ?
    WHERE id = ?
  `).run(new Date(nowMs + delayMs).toISOString(), safeCode, new Date(nowMs).toISOString(), id);
  return result.changes === 1;
}

function listOutboxJobsForTests() {
  return db.prepare("SELECT id, dedupe_key, type, order_id, status, attempts FROM commerce_outbox_jobs ORDER BY id")
    .all().map((row) => ({
      id: row.id,
      dedupeKey: row.dedupe_key,
      type: row.type,
      orderId: row.order_id,
      status: row.status,
      attempts: row.attempts
    }));
}

function resetForTests() {
  return withTransaction(() => {
    db.exec("DELETE FROM commerce_orders;");
    db.exec("DELETE FROM commerce_payment_events;");
    db.exec("DELETE FROM commerce_outbox_jobs;");
    db.exec("DELETE FROM commerce_bot_sessions;");
    db.exec("DELETE FROM commerce_telegram_updates;");
  });
}

migrateLegacyJsonOnce();
migrateLegacyTelegramStateOnce();

module.exports = {
  withTransaction,
  readOrders,
  writeOrders,
  readEvents,
  writeEvents,
  readBotSessions,
  setBotSession,
  hasTelegramUpdate,
  markTelegramUpdate,
  enqueuePaymentNotification,
  claimPendingOutboxJobs,
  completeOutboxJob,
  retryOutboxJob,
  listOutboxJobsForTests,
  resetForTests
};
