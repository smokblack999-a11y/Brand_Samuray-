"use strict";

const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { paymentError } = require("./provider-contract");

const REQUIRED_COLUMNS = Object.freeze({
  orders: ["id", "uid", "total", "status", "updated"],
  payments: ["id", "order_id", "uid", "amount", "method", "status", "ts"]
});

function assertCrmSchema(db) {
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = new Set(db.prepare("PRAGMA table_info(" + table + ")").all().map(row => row.name));
    const missing = expected.filter(name => !actual.has(name));
    if (missing.length) {
      throw paymentError("DELIVERY_CRM_SCHEMA_INVALID", "Delivery CRM table " + table + " is missing columns: " + missing.join(", "));
    }
  }
}

function createDeliveryCrmSqliteAdapter({ dbPath, db, Database = DatabaseSync } = {}) {
  let database = db;
  if (!database) {
    if (typeof dbPath !== "string" || !dbPath.trim() || dbPath === ":memory:") {
      throw paymentError("DELIVERY_CRM_DB_PATH_REQUIRED", "DELIVERY_CRM_DB_PATH must point to an existing CRM SQLite database");
    }
    if (!fs.existsSync(dbPath)) {
      throw paymentError("DELIVERY_CRM_DB_NOT_FOUND", "The configured Delivery CRM SQLite database does not exist");
    }
    database = new Database(dbPath);
  }

  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=30000;");
  assertCrmSchema(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS provider_payment_refs (
      payment_id INTEGER PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
      samurai_payment_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      provider_session_id TEXT NOT NULL UNIQUE,
      provider_payment_intent_id TEXT UNIQUE,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      checkout_revision TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('provider_pending','paid','failed')),
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_payment_refs_status
      ON provider_payment_refs(status, updated_at DESC);
  `);

  function transaction(fn) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function requireCustomerIdentity(req, res, next) {
    const raw = typeof req.get === "function"
      ? req.get("X-SAMURAI-Telegram-User-ID")
      : req.headers?.["x-samurai-telegram-user-id"];
    if (typeof raw !== "string" || !/^\d{1,18}$/.test(raw) || Number(raw) <= 0 || !Number.isSafeInteger(Number(raw))) {
      return res.status(401).json({
        ok: false,
        error: { code: "CUSTOMER_IDENTITY_REQUIRED", message: "A trusted Telegram user identity is required", requestId: req.requestId }
      });
    }
    req.customerTelegramUserId = Number(raw);
    return next();
  }

  function resolveDeliveryOrder(orderId, req) {
    const uid = req?.customerTelegramUserId;
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      throw paymentError("CUSTOMER_IDENTITY_REQUIRED", "Trusted Telegram customer identity is missing");
    }
    const order = database.prepare(
      "SELECT id, uid, total, status, updated FROM orders WHERE id=? AND uid=?"
    ).get(orderId, uid);
    if (!order) return null;
    if (order.status !== "awaiting_payment") return { orderId, payable: false };

    const latest = database.prepare(`
      SELECT p.id AS payment_id, r.checkout_revision, r.status AS provider_status
      FROM payments p
      JOIN provider_payment_refs r ON r.payment_id=p.id
      WHERE p.order_id=? AND p.uid=? AND p.method='stripe_test'
      ORDER BY p.id DESC LIMIT 1
    `).get(orderId, uid);

    let version = String(order.updated);
    if (latest?.provider_status === "provider_pending") {
      version = latest.checkout_revision;
    } else if (latest?.provider_status === "failed") {
      version = String(order.updated) + ":retry:" + latest.payment_id;
    } else if (latest?.provider_status === "paid") {
      return { orderId, payable: false };
    }

    const amountKzt = Number(order.total);
    if (!Number.isSafeInteger(amountKzt) || amountKzt < 1 || amountKzt > 999999) {
      throw paymentError("DELIVERY_ORDER_AMOUNT_INVALID", "Delivery order total is invalid for Stripe Checkout");
    }
    return {
      orderId: order.id,
      payable: true,
      customerId: String(order.uid),
      productName: "Samurai Delivery " + order.id,
      amountMinor: amountKzt * 100,
      currency: "KZT",
      version
    };
  }

  function onDeliveryCheckoutCreated(payment, session, order) {
    if (!payment || !session || !order ||
        typeof payment.paymentId !== "string" ||
        typeof payment.orderId !== "string" ||
        typeof session.sessionId !== "string" ||
        !Number.isSafeInteger(payment.amountMinor) ||
        payment.amountMinor < 100 || payment.amountMinor % 100 !== 0 ||
        payment.currency !== "KZT" ||
        typeof order.version !== "string" && typeof order.version !== "number") {
      throw paymentError("DELIVERY_CHECKOUT_RECORD_INVALID", "Checkout record does not match the Delivery CRM contract");
    }
    const uid = Number(payment.customerId);
    const amountKzt = payment.amountMinor / 100;
    if (!Number.isSafeInteger(uid) || uid <= 0) throw paymentError("DELIVERY_CHECKOUT_CUSTOMER_INVALID", "Delivery customer ID is invalid");

    return transaction(() => {
      const existing = database.prepare(`
        SELECT r.*, p.order_id, p.uid, p.amount, p.status AS payment_status
        FROM provider_payment_refs r JOIN payments p ON p.id=r.payment_id
        WHERE r.provider_session_id=?
      `).get(session.sessionId);
      if (existing) {
        if (existing.samurai_payment_id !== payment.paymentId ||
            existing.order_id !== payment.orderId ||
            existing.uid !== uid ||
            existing.amount !== amountKzt ||
            existing.amount_minor !== payment.amountMinor ||
            existing.currency !== "KZT") {
          throw paymentError("DELIVERY_CHECKOUT_SESSION_MISMATCH", "Existing Checkout Session is linked to different CRM data");
        }
        return existing;
      }

      const prior = database.prepare(
        "SELECT id FROM payments WHERE order_id=? AND uid=? AND method='stripe_test' ORDER BY id DESC LIMIT 1"
      ).get(payment.orderId, uid);
      const orderRow = database.prepare("SELECT status, total FROM orders WHERE id=? AND uid=?").get(payment.orderId, uid);
      if (!orderRow || orderRow.status !== "awaiting_payment" || Number(orderRow.total) !== amountKzt) {
        throw paymentError("DELIVERY_ORDER_NO_LONGER_PAYABLE", "Delivery order changed or is no longer payable");
      }
      const createdAt = Date.now() / 1000;
      const paymentInsert = database.prepare(`
        INSERT INTO payments(order_id,uid,amount,proof,proof_type,method,status,ts)
        VALUES(?,?,?,NULL,NULL,'stripe_test','provider_pending',?)
      `).run(payment.orderId, uid, amountKzt, createdAt);
      const paymentRowId = Number(paymentInsert.lastInsertRowid);
      database.prepare(`
        INSERT INTO provider_payment_refs(
          payment_id,samurai_payment_id,provider,provider_session_id,amount_minor,currency,
          checkout_revision,status,created_at,updated_at
        ) VALUES(?,?,'stripe_test',?,?,? ,?,'provider_pending',?,?)
      `).run(
        paymentRowId,
        payment.paymentId,
        session.sessionId,
        payment.amountMinor,
        "KZT",
        String(order.version),
        createdAt,
        createdAt
      );
      return { paymentRowId, priorPaymentRowId: prior?.id || null, providerSessionId: session.sessionId };
    });
  }

  function onDeliveryPaid(payment, session) {
    if (!payment || !session || typeof session.id !== "string") {
      throw paymentError("DELIVERY_PAYMENT_EVENT_INVALID", "Paid Checkout event is incomplete");
    }
    return transaction(() => {
      const row = database.prepare(`
        SELECT r.*, p.order_id, p.uid, p.amount, p.status AS payment_status,
               o.status AS order_status, o.total AS order_total
        FROM provider_payment_refs r
        JOIN payments p ON p.id=r.payment_id
        JOIN orders o ON o.id=p.order_id
        WHERE r.provider_session_id=? AND r.samurai_payment_id=?
      `).get(session.id, payment.paymentId);
      if (!row) throw paymentError("DELIVERY_PAYMENT_REFERENCE_NOT_FOUND", "Stripe payment is not linked to a Delivery CRM payment");
      if (row.order_id !== payment.orderId || String(row.uid) !== payment.customerId ||
          row.amount_minor !== payment.amountMinor || row.amount !== row.order_total ||
          row.currency !== "KZT" || session.amount_total !== payment.amountMinor ||
          String(session.currency || "").toUpperCase() !== "KZT") {
        throw paymentError("DELIVERY_PAYMENT_AMOUNT_MISMATCH", "Stripe payment does not match the authoritative Delivery order");
      }
      if (row.status === "paid" && row.payment_status === "approved" && row.order_status === "paid") {
        return { ok: true, duplicate: true, orderId: row.order_id };
      }
      if (row.order_status !== "awaiting_payment" || row.status !== "provider_pending") {
        throw paymentError("DELIVERY_ORDER_PAYMENT_CONFLICT", "Delivery order is no longer awaiting this payment");
      }
      const now = Date.now() / 1000;
      const paymentUpdate = database.prepare(
        "UPDATE payments SET status='approved', reviewed_at=? WHERE id=? AND status='provider_pending'"
      ).run(now, row.payment_id);
      if (Number(paymentUpdate.changes) !== 1) {
        throw paymentError("DELIVERY_PAYMENT_STATE_CONFLICT", "Delivery payment was changed concurrently");
      }
      database.prepare(`
        UPDATE provider_payment_refs
        SET status='paid', provider_payment_intent_id=?, updated_at=?
        WHERE payment_id=? AND status='provider_pending'
      `).run(typeof session.payment_intent === "string" ? session.payment_intent : null, now, row.payment_id);
      const orderUpdate = database.prepare(
        "UPDATE orders SET status='paid', updated=? WHERE id=? AND uid=? AND status='awaiting_payment'"
      ).run(now, row.order_id, row.uid);
      if (Number(orderUpdate.changes) !== 1) {
        throw paymentError("DELIVERY_ORDER_STATE_CONFLICT", "Delivery order changed before payment confirmation");
      }
      return { ok: true, duplicate: false, orderId: row.order_id };
    });
  }

  function onDeliveryFailed(payment, session) {
    if (!payment || !session || typeof session.id !== "string") {
      throw paymentError("DELIVERY_PAYMENT_EVENT_INVALID", "Failed Checkout event is incomplete");
    }
    return transaction(() => {
      const row = database.prepare(`
        SELECT r.*, p.status AS payment_status, p.order_id
        FROM provider_payment_refs r JOIN payments p ON p.id=r.payment_id
        WHERE r.provider_session_id=? AND r.samurai_payment_id=?
      `).get(session.id, payment.paymentId);
      if (!row) throw paymentError("DELIVERY_PAYMENT_REFERENCE_NOT_FOUND", "Stripe payment is not linked to a Delivery CRM payment");
      if (row.status === "paid" || row.payment_status === "approved") return { ok: true, ignored: true };
      if (row.status === "failed") return { ok: true, duplicate: true };
      const now = Date.now() / 1000;
      database.prepare(
        "UPDATE provider_payment_refs SET status='failed', updated_at=? WHERE payment_id=? AND status='provider_pending'"
      ).run(now, row.payment_id);
      database.prepare(
        "UPDATE payments SET status='failed' WHERE id=? AND status='provider_pending'"
      ).run(row.payment_id);
      return { ok: true, failed: true, orderId: row.order_id };
    });
  }

  return Object.freeze({
    requireCustomerIdentity,
    resolveDeliveryOrder,
    onDeliveryCheckoutCreated,
    onDeliveryPaid,
    onDeliveryFailed,
    close() { if (!db) database.close(); }
  });
}

function createDomainAdapter({ env = process.env } = {}) {
  const dbPath = String(env.DELIVERY_CRM_DB_PATH || "").trim();
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw paymentError("DELIVERY_CRM_DB_NOT_FOUND", "Set DELIVERY_CRM_DB_PATH to the existing Samurai Delivery CRM SQLite database");
  }
  return createDeliveryCrmSqliteAdapter({ dbPath });
}

module.exports = { createDeliveryCrmSqliteAdapter, createDomainAdapter };
