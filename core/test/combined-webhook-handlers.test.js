"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("combined payment handlers dispatch completed Checkout by mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-combined-webhooks-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  try {
    delete require.cache[require.resolve("../payments/ledger")];
    const { createPaymentLedger } = require("../payments/ledger");
    const { createPaymentWebhookHandlers } = require("../payments/combined-webhook-handlers");
    const ledger = createPaymentLedger();
    const calls = [];
    const handlers = createPaymentWebhookHandlers({
      ledger,
      onDeliveryPaid: async () => calls.push("delivery"),
      onSubscriptionStatusChange: async record => calls.push(record.status)
    });
    const session = {
      id: "cs_combo_sub", mode: "subscription", subscription: "sub_combo", customer: "cus_combo",
      metadata: { samurai_flow: "saas", samurai_customer_id: "customer_combo", samurai_plan_id: "pro" }
    };
    await handlers["checkout.session.completed"](session, { type: "checkout.session.completed", created: 100 });
    await handlers["invoice.paid"]({ subscription: "sub_combo", customer: "cus_combo" }, { type: "invoice.paid", created: 101 });
    assert.deepEqual(calls, ["pending", "active"]);
    assert.equal(ledger.getSubscriptionByProviderId("sub_combo").status, "active");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
