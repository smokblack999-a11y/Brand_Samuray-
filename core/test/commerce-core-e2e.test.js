"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CORE_DIR = path.resolve(__dirname, "..");
const BOT_TOKEN = "123456:COMMERCE_TEST_BOT_TOKEN";
const API_SECRET = "commerce-core-test-api-key-not-used-by-miniapp";
const WEBHOOK_SECRET = "commerce-test-webhook-secret";
let child;
let dataDir;
let baseUrl;
let stdout = "";
let stderr = "";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function telegramInitData(user, token = BOT_TOKEN) {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "AAE-commercetest-query");
  params.set("user", JSON.stringify(user));
  const checkString = [...params.entries()].map(([key, value]) => key + "=" + value).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

async function webAppRequest(pathname, initData, options = {}) {
  const headers = { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) };
  if (initData !== undefined) headers["X-Telegram-Init-Data"] = initData;
  return fetch(baseUrl + pathname, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-commerce-e2e-"));
  const port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, ["server.js"], {
    cwd: CORE_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATA_DIR: dataDir,
      AUTO_REPLY: "false",
      OPENAI_API_KEY: "",
      CORE_API_KEY: API_SECRET,
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      COMMERCE_ENABLED: "true",
      COMMERCE_MODE: "test",
      COMMERCE_TEST_PAYMENTS_ENABLED: "false",
      STRIPE_TEST_MODE: "false",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-8000); });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 12000) {
    if (child.exitCode !== null) throw new Error("Core exited before startup. stdout=" + stdout + " stderr=" + stderr);
    try { const response = await fetch(baseUrl + "/health"); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Core startup timed out. stdout=" + stdout + " stderr=" + stderr);
});

test.after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 1500); });
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

test("running Core reports Commerce readiness when the test store is enabled", async () => {
  const response = await fetch(baseUrl + "/ready");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.commerce, "ready");
});

test("catalog requires valid Telegram WebApp initData and does not expose delivery content", async () => {
  const unauthorized = await webAppRequest("/v1/commerce/catalog");
  assert.equal(unauthorized.status, 401);
  const initData = telegramInitData({ id: 751234567, first_name: "Commerce", username: "test_buyer" });
  const response = await webAppRequest("/v1/commerce/catalog", initData);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "test");
  assert.ok(body.products.some(p => p.sku === "demo-digital-guide"));
  assert.ok(body.products.every(p => !Object.prototype.hasOwnProperty.call(p, "deliveryText")));
});

test("actual Core creates a priced order, enforces ownership, and restores stock on cancellation", async () => {
  const buyer = telegramInitData({ id: 751234568, first_name: "Buyer" });
  const otherBuyer = telegramInitData({ id: 751234569, first_name: "Other" });
  const create = await webAppRequest("/v1/commerce/orders", buyer, { method: "POST", body: { sku: "demo-digital-guide", quantity: 2, customerId: "attacker-controlled" } });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.order.totalMinor, 3980);
  assert.equal(created.order.customerId, "tg:751234568");
  assert.equal(created.order.status, "pending_payment");

  const own = await webAppRequest("/v1/commerce/orders/" + created.order.id, buyer);
  assert.equal(own.status, 200);
  const foreign = await webAppRequest("/v1/commerce/orders/" + created.order.id, otherBuyer);
  assert.equal(foreign.status, 404);

  const disabledCheckout = await webAppRequest("/v1/commerce/orders/" + created.order.id + "/checkout", buyer, { method: "POST", body: {} });
  assert.equal(disabledCheckout.status, 404);
  const disabledSimulation = await webAppRequest("/v1/commerce/orders/" + created.order.id + "/simulate-payment", buyer, { method: "POST", body: {} });
  assert.equal(disabledSimulation.status, 404);

  const cancelled = await webAppRequest("/v1/commerce/orders/" + created.order.id + "/cancel", buyer, { method: "POST", body: {} });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).order.status, "cancelled");
  const catalogue = await (await webAppRequest("/v1/commerce/catalog", buyer)).json();
  assert.equal(catalogue.products.find(p => p.sku === "demo-digital-guide").stock, 100);
});

test("tampered Telegram initData is rejected by the real Core middleware", async () => {
  const valid = telegramInitData({ id: 751234570, first_name: "Tamper test" });
  const tampered = valid.replace("Tamper+test", "Forged+user");
  const response = await webAppRequest("/v1/commerce/catalog", tampered);
  assert.equal(response.status, 401);
});
