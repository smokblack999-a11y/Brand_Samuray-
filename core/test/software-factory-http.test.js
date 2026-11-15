"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  FactoryBridgeError,
  createFactoryBridge,
  createSoftwareFactoryRouter,
  statusForCode
} = require("../software-factory-http");

async function startTestServer(runWorker) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use((req, _res, next) => {
    req.requestId = "factory-test-request";
    next();
  });
  const requireApiKey = (req, res, next) => {
    if (req.get("X-API-Key") !== "test-admin-key") {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED" } });
    }
    next();
  };
  app.use("/v1/software-factory", createSoftwareFactoryRouter({ requireApiKey, runWorker }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}/v1/software-factory`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

test("Software Factory list route requires the existing API-key middleware", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return { modules: {} };
  });
  try {
    const response = await fetch(`${server.base}/modules`);
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory list route returns worker data and requestId", async () => {
  const calls = [];
  const server = await startTestServer(async payload => {
    calls.push(payload);
    return { modules: { processor: { version: 1, status: "validated" } } };
  });
  try {
    const response = await fetch(`${server.base}/modules`, {
      headers: { "X-API-Key": "test-admin-key" }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.requestId, "factory-test-request");
    assert.equal(body.modules.processor.version, 1);
    assert.deepEqual(calls, [{ action: "list" }]);
  } finally {
    await server.close();
  }
});

test("Software Factory create route enforces source size before worker invocation", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return { module: {} };
  });
  try {
    const response = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({ name: "processor", source: "x".repeat(65 * 1024) })
    });
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.error.code, "SOURCE_TOO_LARGE");
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory create route dispatches a bounded source payload", async () => {
  let received;
  const server = await startTestServer(async payload => {
    received = payload;
    return { module: { name: "processor", version: 1 } };
  });
  try {
    const response = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({ name: "processor", source: "def run(data):\\n    return list(data)\\n" })
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.module.version, 1);
    assert.equal(received.action, "create");
    assert.equal(received.name, "processor");
  } finally {
    await server.close();
  }
});

test("Software Factory rollback validates target version", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return {};
  });
  try {
    const response = await fetch(`${server.base}/modules/processor/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({ version: 0 })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VERSION_INVALID");
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory worker errors are normalized without exposing filesystem details", async () => {
  const server = await startTestServer(async () => {
    throw new FactoryBridgeError("MODULE_HASH_MISMATCH", 409);
  });
  try {
    const response = await fetch(`${server.base}/modules/processor/promote`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({ source: "def run(data):\\n    return list(data)\\n" })
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "MODULE_HASH_MISMATCH");
    assert.equal(body.error.message, "Software Factory operation failed");
    assert.equal(JSON.stringify(body).includes("/home/"), false);
  } finally {
    await server.close();
  }
});

test("worker bridge invokes the Python JSON protocol without a shell", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-factory-worker-"));
  try {
    const runWorker = createFactoryBridge({ python: process.env.SOFTWARE_FACTORY_PYTHON || "python3", root });
    const result = await runWorker({ action: "list" });
    assert.deepEqual(result.modules, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("worker bridge refuses oversized input without spawning", async () => {
  const runWorker = createFactoryBridge({ python: "python3", root: os.tmpdir() });
  await assert.rejects(
    runWorker({ action: "create", name: "processor", source: "x".repeat(100 * 1024) }),
    error => error instanceof FactoryBridgeError && error.code === "REQUEST_TOO_LARGE"
  );
});

test("worker error status map uses conflict and service-unavailable classes", () => {
  assert.equal(statusForCode("MODULE_ALREADY_EXISTS"), 409);
  assert.equal(statusForCode("SANDBOX_TIMEOUT"), 503);
  assert.equal(statusForCode("SOURCE_SYNTAX_INVALID"), 400);
});
