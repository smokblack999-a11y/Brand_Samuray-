"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-webhooks-"));
  process.env.PAYMENTS_DATA_DIR = dir;
  delete require.cache[require.resolve("../payments/ledger")];
  const { createPaymentLedger } = require("../payments/ledger");
  const { createStripeWebhookProcessor } = require("../payments/webhook-processor");
  const ledger = createPaymentLedger();
  const event = { id: "evt_abc", type: "checkout.session.completed", data: { object: { id: "cs_abc", payment_status: "paid" } } };
  const provider = {
    async verifyWebhook(rawBody, headers) {
      if (!Buffer.isBuffer(rawBody) || headers["stripe-signature"] !== "valid") throw new Error("signature rejected");
      return event;
    },
    async parseWebhook(value) {
      return { eventId: value.id, type: value.type, object: value.data.object };
    }
  };
  return { dir, ledger, event, create: handlers => createStripeWebhookProcessor({ provider, ledger, handlers }) };
}

test("webhook processor verifies, claims once, and ignores duplicate delivery", async () => {
  const ctx = setup();
  try {
    let handled = 0;
    const processor = ctx.create({ "checkout.session.completed": async object => {
      handled += 1;
      assert.equal(object.payment_status, "paid");
    } });
    const args = [Buffer.from("{}"), { "stripe-signature": "valid" }];
    assert.deepEqual(await processor.process(...args), { received: true, duplicate: false, eventId: "evt_abc" });
    assert.deepEqual(await processor.process(...args), { received: true, duplicate: true, eventId: "evt_abc" });
    assert.equal(handled, 1);
    assert.equal(ctx.ledger.listEvents()[0].status, "completed");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("failed handlers remain retryable and are not acknowledged as completed", async () => {
  const ctx = setup();
  try {
    let attempts = 0;
    const processor = ctx.create({ "checkout.session.completed": async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("temporary"), { code: "TEMPORARY" });
    } });
    const args = [Buffer.from("{}"), { "stripe-signature": "valid" }];
    await assert.rejects(() => processor.process(...args), /temporary/);
    assert.equal(ctx.ledger.listEvents()[0].status, "failed");
    const result = await processor.process(...args);
    assert.equal(result.duplicate, false);
    assert.equal(attempts, 2);
    assert.equal(ctx.ledger.listEvents()[0].status, "completed");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("unknown webhook event is failed for provider retry rather than silently discarded", async () => {
  const ctx = setup();
  try {
    const processor = ctx.create({});
    await assert.rejects(() => processor.process(Buffer.from("{}"), { "stripe-signature": "valid" }),
      error => error.code === "PAYMENT_WEBHOOK_UNHANDLED");
    assert.equal(ctx.ledger.listEvents()[0].status, "failed");
    assert.equal(ctx.ledger.listEvents()[0].errorCode, "UNHANDLED_EVENT");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
