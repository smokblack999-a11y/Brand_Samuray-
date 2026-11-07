const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const port = 19000 + Math.floor(Math.random() * 10000);
const apiKey = "staging-core-test-key";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-core-readiness-"));
let child;

async function get(pathname, headers = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
}

test.before(async () => {
  child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: dataDir,
      CORE_API_KEY: apiKey,
      TELEGRAM_WEBHOOK_SECRET: "",
      AUTO_REPLY: "false",
      OPENAI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("staging server startup timeout")), 10000);
    const poll = async () => {
      if (child.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error(`staging server exited early: ${child.exitCode}`));
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {}
      setTimeout(poll, 100);
    };
    child.once("error", reject);
    poll();
  });
});

test.after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
});

test("Core production readiness does not require Telegram configuration", async () => {
  const core = await get("/ready");
  assert.equal(core.status, 200);
  const coreBody = await core.json();
  assert.equal(coreBody.ready, true);
  assert.equal(coreBody.integrations.telegramConfigured, false);

  const telegram = await get("/ready/telegram", { "X-API-Key": apiKey });
  assert.equal(telegram.status, 503);
  const telegramBody = await telegram.json();
  assert.equal(telegramBody.ready, false);
});

test("GitHub webhook rejects payloads larger than 1 MiB", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/agent-control/github/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: "x".repeat(1_100_000) })
  });
  assert.equal(response.status, 413);
});

test("small GitHub webhook reaches signature gate when no secret is configured", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/agent-control/github/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow_run: { id: 1 } })
  });
  assert.equal(response.status, 503);
});

test("all sensitive API routes reject requests without the API key", async () => {
  const protectedRoutes = [
    ["GET", "/ready/telegram"],
    ["GET", "/health/openai"],
    ["GET", "/api/leads"],
    ["GET", "/api/stats"],
    ["GET", "/api/agent-control/health"],
    ["GET", "/api/agent-control/jobs"],
    ["GET", "/api/agent-control/jobs/missing"],
    ["POST", "/api/agent-control/jobs/missing/evidence"],
    ["POST", "/api/agent-control/jobs/missing/propose"],
    ["POST", "/api/agent-control/jobs/missing/sandbox"],
    ["POST", "/api/agent-control/jobs/missing/ci"],
    ["POST", "/api/agent-control/jobs/missing/proof"],
    ["POST", "/api/agent-control/jobs/missing/diagnose"],
    ["GET", "/api/dual-ai/config"],
    ["GET", "/api/dual-ai/sessions"],
    ["GET", "/api/dual-ai/session/missing"],
    ["POST", "/api/dual-ai/session"],
    ["POST", "/api/dual-ai/turn"],
    ["POST", "/api/dual-ai/stop"],
    ["GET", "/api/dual-ai/export/missing"],
    ["POST", "/api/lead/analyze"],
    ["GET", "/api/telegram/me"],
    ["GET", "/api/telegram/dialogs"],
    ["GET", "/api/telegram/messages?chatId=123"],
    ["POST", "/api/telegram/send"],
    ["POST", "/api/telegram/send-photo"]
  ];

  for (const [method, pathname] of protectedRoutes) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? "{}" : undefined
    });
    assert.equal(response.status, 401, `${method} ${pathname} must require X-API-Key`);
  }
});

test("public health endpoints remain available and Telegram webhook fails closed without secret", async () => {
  assert.equal((await get("/health")).status, 200);
  assert.equal((await get("/ready")).status, 200);

  const response = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 503);
});
