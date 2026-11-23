"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createDeliveryCrmSqliteAdapter } = require("../payments/delivery-crm-sqlite-adapter");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, uid INTEGER NOT NULL, total INTEGER NOT NULL,
      status TEXT NOT NULL, updated REAL NOT NULL
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      uid INTEGER NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL,
      status TEXT NOT NULL, ts REAL NOT NULL
    );
    INSERT INTO orders(id,uid,total,status,updated) VALUES
      ('A-0001',42,1250,'awaiting_payment',1000),
      ('A-0002',43,2500,'awaiting_payment',2000);
  `);
  const adapter = createDeliveryCrmSqliteAdapter({ db });
  const request = { customerTelegramUserId: 42 };
  const payment = {
    paymentId: "pay_delivery_0001",
    orderId: "A-0001",
    customerId: "42",
    provider: "stripe_test",
    amountMinor: 125000,
    currency: "kzt"
  };
  const order = {
    orderId: "A-0001",
    payable: true,
    customerId: "42",
    productName: "Samurai Delivery A-0001",
    amountMinor: 125000,
    currency: "KZT",
    version: "1000"
  };
  return { db, adapter, request, payment, order };
}

test("CRM identity middleware requires a trusted Telegram user ID header", () => {
  const { adapter, db } = setup();
  try {
    let nextCalled = false;
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    adapter.requireCustomerIdentity({ get: () => "" }, response, () => { nextCalled = true; });
    assert.equal(response.code, 401);
    assert.equal(nextCalled, false);

    adapter.requireCustomerIdentity({ get: () => "42" }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  } finally {
    db.close();
  }
});

test("Delivery resolver enforces CRM order ownership and converts KZT to Stripe minor units", () => {
  const { adapter, request, db } = setup();
  try {
    const order = adapter.resolveDeliveryOrder("A-0001", request);
    assert.equal(order.payable, true);
    assert.equal(order.amountMinor, 125000);
    assert.equal(order.currency, "KZT");
    assert.equal(adapter.resolveDeliveryOrder("A-0001", { customerTelegramUserId: 43 }), null);
  } finally {
    db.close();
  }
});

test("Checkout reservation locks order against manual approval and retries use same revision", () => {
  const { adapter, request, payment, order, db } = setup();
  try {
    adapter.onDeliveryCheckoutPreparing(payment, order);
    const row = db.prepare("SELECT status FROM orders WHERE id='A-0001'").get();
    assert.equal(row.status, "checkout_pending");
    const resolved = adapter.resolveDeliveryOrder("A-0001", request);
    assert.equal(resolved.payable, true);
    assert.equal(resolved.version, "1000");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments").get().count, 1);
  } finally {
    db.close();
  }
});

test("Checkout session binding is idempotent and payment success atomically marks order paid", () => {
  const { adapter, payment, order, db } = setup();
  try {
    adapter.onDeliveryCheckoutPreparing(payment, order);
    const session = { sessionId: "cs_delivery_0001" };
    adapter.onDeliveryCheckoutCreated(payment, session, order);
    adapter.onDeliveryCheckoutCreated(payment, session, order);
    const stripeEvent = {
      id: session.sessionId,
      amount_total: 125000,
      currency: "kzt",
      payment_intent: "pi_delivery_0001"
    };
    assert.deepEqual(adapter.onDeliveryPaid(payment, stripeEvent), { ok: true, duplicate: false, orderId: "A-0001" });
    assert.deepEqual(adapter.onDeliveryPaid(payment, stripeEvent), { ok: true, duplicate: true, orderId: "A-0001" });
    assert.equal(db.prepare("SELECT status FROM orders WHERE id='A-0001'").get().status, "paid");
    assert.equal(db.prepare("SELECT status FROM payments").get().status, "approved");
    assert.equal(db.prepare("SELECT status FROM provider_payment_refs").get().status, "paid");
  } finally {
    db.close();
  }
});

test("Definitive Checkout failure releases the order for a new payment attempt", () => {
  const { adapter, payment, order, request, db } = setup();
  try {
    adapter.onDeliveryCheckoutPreparing(payment, order);
    adapter.onDeliveryCheckoutFailed(payment, Object.assign(new Error("bad request"), { statusCode: 400 }));
    assert.equal(db.prepare("SELECT status FROM orders WHERE id='A-0001'").get().status, "awaiting_payment");
    const retry = adapter.resolveDeliveryOrder("A-0001", request);
    assert.equal(retry.payable, true);
    assert.match(retry.version, /retry/);
  } finally {
    db.close();
  }
});

test("Expired or async-failed Checkout marks attempt failed but never rolls back a paid order", () => {
  const { adapter, payment, order, db } = setup();
  try {
    adapter.onDeliveryCheckoutPreparing(payment, order);
    adapter.onDeliveryCheckoutCreated(payment, { sessionId: "cs_delivery_0001" }, order);
    const event = { id: "cs_delivery_0001" };
    adapter.onDeliveryFailed(payment, event);
    assert.equal(db.prepare("SELECT status FROM orders WHERE id='A-0001'").get().status, "awaiting_payment");
    assert.equal(db.prepare("SELECT status FROM provider_payment_refs").get().status, "failed");
  } finally {
    db.close();
  }
});

test("Paid amount mismatch is rejected and transaction leaves order unchanged", () => {
  const { adapter, payment, order, db } = setup();
  try {
    adapter.onDeliveryCheckoutPreparing(payment, order);
    adapter.onDeliveryCheckoutCreated(payment, { sessionId: "cs_delivery_0001" }, order);
    assert.throws(() => adapter.onDeliveryPaid(payment, {
      id: "cs_delivery_0001", amount_total: 1, currency: "usd", payment_intent: "pi_bad"
    }), error => error.code === "DELIVERY_PAYMENT_AMOUNT_MISMATCH");
    assert.equal(db.prepare("SELECT status FROM orders WHERE id='A-0001'").get().status, "checkout_pending");
    assert.equal(db.prepare("SELECT status FROM payments").get().status, "provider_pending");
  } finally {
    db.close();
  }
});
