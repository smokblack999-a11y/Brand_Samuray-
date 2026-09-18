"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-core-test-"));
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.CORE_API_KEY = "test-core-api-key-123456";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-123456";
process.env.LEAD_RATE_LIMIT_MAX = "2";
process.env.LEAD_RATE_LIMIT_WINDOW_MS = "60000";
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";

const { server } = require("./server");

function baseUrl() {
  return `http://127.0.0.1:${server.address().port}`;
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl()}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  return { response, body };
}

test("Core HTTP contract: health, ready, auth and 404", async () => {
  const health = await jsonRequest("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const ready = await jsonRequest("/ready");
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.ready, true);
  assert.ok(ready.body.requestId);

  const unauthorized = await jsonRequest("/api/stats");
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.body.error.code, "UNAUTHORIZED");
  assert.ok(unauthorized.body.error.requestId);

  const notFound = await jsonRequest("/does-not-exist");
  assert.equal(notFound.response.status, 404);
  assert.equal(notFound.body.error.code, "NOT_FOUND");
});

test("Core lead endpoint enforces rate limit", async () => {
  const options = {
    method: "POST",
    headers: { "X-API-Key": process.env.CORE_API_KEY },
    body: JSON.stringify({ message: "Хочу купить сегодня" })
  };

  const first = await jsonRequest("/api/lead/analyze", options);
  const second = await jsonRequest("/api/lead/analyze", options);
  const third = await jsonRequest("/api/lead/analyze", options);

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(third.response.status, 429);
  assert.equal(third.body.error.code, "RATE_LIMITED");
  assert.ok(third.body.error.requestId);
  assert.ok(Number(third.response.headers.get("retry-after")) >= 1);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});
