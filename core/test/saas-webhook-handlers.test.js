"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-saas-webhooks-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  delete require.cache[require.resolve("../payments/ledger")];
  const { createPaymentLedger } = require("../payments/ledger");
  const { createSaasWebhookHandlers } = require("../payments/saas-webhook-handlers");
  const ledger = createPaymentLedger();
  const calls = [];
  const handlers = createSaasWebhookHandlers({ ledger, onStatusChange: async (record, event) => calls.push({ status: record.status, type: event?.type }) });
  const session = {
    id: "cs_saas_123", mode: "subscription", subscription: "sub_123", customer: "cus_123",
    metadata: { samurai_flow: "saas", samurai_customer_id: "customer_123", samurai_plan_id: "pro" }
  };
  return { dir, ledger, handlers, calls, session };
}

test("SaaS Checkout creates a pending local subscription, invoice.paid activates it", async () => {
  const ctx = setup();
  try {
    await ctx.handlers["checkout.session.completed"](ctx.session, { type: "checkout.session.completed" });
    assert.equal(ctx.ledger.getSubscriptionByProviderId("sub_123").status, "pending");
    await ctx.handlers["invoice.paid"]({ subscription: "sub_123", customer: "cus_123" }, { type: "invoice.paid" });
    assert.equal(ctx.ledger.getSubscriptionByProviderId("sub_123").status, "active");
    assert.deepEqual(ctx.calls.map(x => x.status), ["pending", "active"]);
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("invoice failure and subscription deletion update entitlement state", async () => {
  const ctx = setup();
  try {
    await ctx.handlers["checkout.session.completed"](ctx.session, { type: "checkout.session.completed" });
    await ctx.handlers["invoice.payment_failed"]({ subscription: "sub_123", customer: "cus_123" }, { type: "invoice.payment_failed" });
    assert.equal(ctx.ledger.getSubscriptionByProviderId("sub_123").status, "past_due");
    await ctx.handlers["customer.subscription.deleted"]({ id: "sub_123", customer: "cus_123" }, { type: "customer.subscription.deleted" });
    assert.equal(ctx.ledger.getSubscriptionByProviderId("sub_123").status, "canceled");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("SaaS webhook rejects customer and metadata mismatches", async () => {
  const ctx = setup();
  try {
    await assert.rejects(() => ctx.handlers["checkout.session.completed"]({
      ...ctx.session, metadata: { ...ctx.session.metadata, samurai_customer_id: "" }
    }, { type: "checkout.session.completed" }), error => error.code === "PAYMENT_SUBSCRIPTION_METADATA_INVALID");
    await ctx.handlers["checkout.session.completed"](ctx.session, { type: "checkout.session.completed" });
    await assert.rejects(() => ctx.handlers["invoice.paid"]({ subscription: "sub_123", customer: "cus_wrong" }, { type: "invoice.paid" }),
      error => error.code === "PAYMENT_SUBSCRIPTION_CUSTOMER_MISMATCH");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("duplicate SaaS Checkout completion does not create duplicate subscription records", async () => {
  const ctx = setup();
  try {
    await ctx.handlers["checkout.session.completed"](ctx.session, { type: "checkout.session.completed" });
    await ctx.handlers["checkout.session.completed"](ctx.session, { type: "checkout.session.completed" });
    assert.equal(ctx.calls.length, 1);
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
