"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-revenue-recovery-"));
const port = 19000 + Math.floor(Math.random() * 10000);
const API_KEY = "test-revenue-recovery-api-key";
const WEBHOOK_SECRET = "test-revenue-recovery-webhook-secret";
const baseUrl = "http://127.0.0.1:" + port;
let child;
let stderr = "";

async function request(pathname, options = {}, withKey = true) {
  const headers = {
    ...(withKey ? { "X-API-Key": API_KEY } : {}),
    ...(options.headers || {})
  };
  return fetch(baseUrl + pathname, { ...options, headers });
}

test.before(async () => {
  child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATA_DIR: dataDir,
      AUTO_REPLY: "false",
      OPENAI_API_KEY: "",
      CORE_API_KEY: API_KEY,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server startup timeout: " + stderr.slice(-2000))), 12000);
    const poll = async () => {
      if (child.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error("server exited during startup: " + stderr.slice(-2000)));
        return;
      }
      try {
        const response = await fetch(baseUrl + "/health");
        if (response.ok) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {}
      setTimeout(poll, 100);
    };
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    poll();
  });
});

test.after(() => {
  child?.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("revenue recovery audit endpoint requires API key", async () => {
  const response = await request("/api/revenue-recovery/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD", leads: [] })
  }, false);
  assert.equal(response.status, 401);
});

test("revenue recovery audit endpoint accepts CSV and returns report", async () => {
  const csv = [
    "lead_id,created_at,first_response_at,outcome",
    "A,2026-10-01T09:00:00Z,2026-10-01T09:02:00Z,won",
    "B,2026-10-01T09:00:00Z,2026-10-01T09:20:00Z,open",
    "C,2026-10-01T09:00:00Z,,lost"
  ].join("\n");
  const response = await request("/api/revenue-recovery/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD", slaMinutes: 5, csv })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.report.schemaVersion, "samurai.revenue-recovery.audit.v1");
  assert.equal(body.report.summary.totalLeads, 3);
  assert.equal(body.report.summary.responsesWithinSla, 1);
  assert.equal(body.report.summary.responsesAfterSla, 1);
  assert.equal(body.report.summary.noRecordedFirstResponse, 1);
  assert.ok(body.requestId);
});

test("revenue recovery audit endpoint rejects invalid CSV safely", async () => {
  const response = await request("/api/revenue-recovery/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD", csv: "lead_id,created_at\nA,2026-10-01T09:00:00Z" })
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INVALID_CSV");
  assert.ok(body.requestId);
});
