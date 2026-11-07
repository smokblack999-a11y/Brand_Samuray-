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
