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

test("concurrent duplicate delivery is not acknowledged while the first handler is in progress", async () => {
  const ctx = setup();
  try {
    let release;
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const waitPromise = new Promise(resolve => { release = resolve; });
    const processor = ctx.create({ "checkout.session.completed": async () => {
      started();
      await waitPromise;
    } });
    const args = [Buffer.from("{}"), { "stripe-signature": "valid" }];
    const first = processor.process(...args);
    await startedPromise;
    await assert.rejects(() => processor.process(...args),
      error => error.code === "PAYMENT_WEBHOOK_IN_PROGRESS");
    release();
    const result = await first;
    assert.equal(result.duplicate, false);
    assert.equal(ctx.ledger.listEvents()[0].status, "completed");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});

test("stale processing claims can be reclaimed after a worker crash", async () => {
  const ctx = setup();
  try {
    const claim = ctx.ledger.claimEvent("evt_abc", "checkout.session.completed", "cs_abc");
    assert.equal(claim.claimed, true);
    const file = path.join(ctx.dir, "payments-ledger.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.events.evt_abc.updatedAt = new Date(Date.now() - 600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(state));
    const processor = ctx.create({ "checkout.session.completed": async () => {} });
    const result = await processor.process(Buffer.from("{}"), { "stripe-signature": "valid" });
    assert.equal(result.duplicate, false);
    assert.equal(ctx.ledger.listEvents()[0].attempts, 2);
    assert.equal(ctx.ledger.listEvents()[0].status, "completed");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.PAYMENTS_DATA_DIR;
  }
});
