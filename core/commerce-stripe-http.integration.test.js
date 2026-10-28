"use strict";

// Real HTTP-boundary regression test for Stripe webhook verification and SQLite recovery.
// Stripe's outbound Checkout API is stubbed; inbound webhook requests use the actual Core route.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const API_KEY = "core-http-test-key";
const WEBHOOK_SECRET = "whsec_core_http_test_only";
const STRIPE_SECRET = "sk_test_core_http_stub";
const BOOTSTRAP = String.raw`
  global.fetch = async (url, options = {}) => {
    if (url !== "https://api.stripe.com/v1/checkout/sessions") {
      throw new Error("Unexpected outbound URL in HTTP integration test");
    }
    const form = new URLSearchParams(options.body);
    const orderId = form.get("client_reference_id");
    const amount = Number(form.get("line_items[0][price_data][unit_amount]"));
    return {
      ok: true,
      json: async () => ({
        id: "cs_test_http_integration",
        object: "checkout.session",
        livemode: false,
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        client_reference_id: orderId,
        metadata: { order_id: orderId },
        currency: "kzt",
        amount_total: amount,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        url: "https://checkout.stripe.com/c/pay/cs_test_http_integration"
      })
    };
  };
  const core = require("./server");
  const commerce = require("./commerce");
  (async () => {
    let data = {};
    if (process.env.BOOTSTRAP_COMMERCE === "true") {
      const order = commerce.createOrder({
        customerId: "http-test-customer",
        productId: "tea",
        quantity: 2,
        fulfillment: "pickup"
      });
      const checkout = await commerce.createCheckoutSession(order.id);
      data = {
        orderId: order.id,
        sessionId: checkout.sessionId,
        amountMinor: commerce.getOrder(order.id).totalKzt * 100
      };
    }
    process.stdout.write("READY:" + JSON.stringify(data) + "\\n");
  })().catch(error => {
    process.stderr.write(String(error.stack || error) + "\\n");
    process.exit(1);
  });
`;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function startCore({ port, dataDir, bootstrap }) {
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    COMMERCE_DB_PATH: path.join(dataDir, "commerce.sqlite"),
    CORE_API_KEY: API_KEY,
    TELEGRAM_WEBHOOK_SECRET: "telegram-http-test-secret",
    STRIPE_SECRET_KEY: STRIPE_SECRET,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    COMMERCE_SUCCESS_URL: "https://example.com/success",
    COMMERCE_CANCEL_URL: "https://example.com/cancel",
    COMMERCE_CURRENCY: "KZT",
    COMMERCE_PRODUCTS_JSON: JSON.stringify([{ id: "tea", name: "Tea", priceKzt: 1200, active: true }]),
    COMMERCE_DELIVERY_ZONES_JSON: "{}",
    NODE_ENV: "test",
    BOOTSTRAP_COMMERCE: bootstrap ? "true" : "false"
  };
  const child = spawn(process.execPath, ["-e", BOOTSTRAP], {
    cwd: __dirname,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = readline.createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Core startup timed out: " + stderr)), 10000);
    stdout.on("line", line => {
      if (!line.startsWith("READY:")) return;
      clearTimeout(timeout);
      try { resolve(JSON.parse(line.slice(6))); }
      catch (error) { reject(error); }
    });
    child.once("exit", code => {
      clearTimeout(timeout);
      reject(new Error("Core exited before ready (" + code + "): " + stderr));
    });
  });
  return { child, stdout, ready, getStderr: () => stderr };
}

function signature(raw, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac("sha256", secret)
    .update(String(timestamp) + ".").update(raw).digest("hex");
  return "t=" + timestamp + ",v1=" + digest;
}

async function sendEvent(port, raw, header) {
  return fetch("http://127.0.0.1:" + port + "/api/commerce/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "Stripe-Signature": header },
    body: raw
  });
}

async function readOrder(port, orderId) {
  const response = await fetch("http://127.0.0.1:" + port + "/api/commerce/orders/" + encodeURIComponent(orderId), {
    headers: { "X-API-Key": API_KEY }
  });
  assert.equal(response.status, 200);
  return (await response.json()).order;
}

test("actual Core HTTP Stripe webhook verifies signature, deduplicates, and survives restart", async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-stripe-http-"));
  const port = await freePort();
  let core = startCore({ port, dataDir, bootstrap: true });
  t.after(() => {
    try { core.child.kill("SIGTERM"); } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const created = await core.ready;
  assert.ok(created.orderId);
  assert.equal(created.sessionId, "cs_test_http_integration");
  const event = {
    id: "evt_http_integration_001",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: {
      id: created.sessionId,
      livemode: false,
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      client_reference_id: created.orderId,
      metadata: { order_id: created.orderId },
      amount_total: created.amountMinor,
      currency: "kzt"
    } }
  };
  const raw = Buffer.from(JSON.stringify(event));
  const validHeader = signature(raw, WEBHOOK_SECRET);

  const invalid = await sendEvent(port, Buffer.from(raw.toString().replace("evt_http_integration_001", "evt_tampered")), validHeader);
  assert.equal(invalid.status, 400, "tampered body must be rejected");

  const first = await sendEvent(port, raw, validHeader);
  assert.equal(first.status, 200, await first.text());
  assert.equal((await first.json()).processed, true);
  assert.equal((await readOrder(port, created.orderId)).paymentStatus, "PAID");

  const replay = await sendEvent(port, raw, validHeader);
  assert.equal(replay.status, 200, await replay.text());
  assert.equal((await replay.json()).duplicate, true);
  assert.equal((await readOrder(port, created.orderId)).paymentStatus, "PAID");

  core.child.kill("SIGTERM");
  await new Promise(resolve => core.child.once("exit", resolve));
  core = startCore({ port, dataDir, bootstrap: false });
  await core.ready;
  const restored = await readOrder(port, created.orderId);
  assert.equal(restored.paymentStatus, "PAID");
  assert.equal(restored.checkoutSessionId, created.sessionId);
});
