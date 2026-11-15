"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  FactoryBridgeError,
  assertFactoryWorkerReady,
  assertSoftwareFactoryConfig,
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

test("Software Factory create route dispatches a bounded source payload and JSON test contract", async () => {
  let received;
  const server = await startTestServer(async payload => {
    received = payload;
    return { module: { name: "processor", version: 1 } };
  });
  try {
    const contract = { cases: [{ input: [1, 2], expected: [2, 4] }] };
    const response = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({
        name: "processor",
        source: "def run(data):\n    return [x * 2 for x in data]\n",
        contract
      })
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.module.version, 1);
    assert.equal(received.action, "create");
    assert.equal(received.name, "processor");
    assert.deepEqual(received.contract, contract);
  } finally {
    await server.close();
  }
});

test("Software Factory create route rejects oversized test contracts before worker invocation", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return { module: {} };
  });
  try {
    const response = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({
        name: "processor",
        source: "def run(data):\n    return data\n",
        contract: { cases: [{ input: "x".repeat(33 * 1024), expected: "x" }] }
      })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "CONTRACT_TOO_LARGE");
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory create route rejects more than twenty contract cases", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return { module: {} };
  });
  try {
    const response = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({
        name: "processor",
        source: "def run(data):\n    return data\n",
        contract: { cases: Array.from({ length: 21 }, () => ({ input: [1], expected: [1] })) }
      })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "CONTRACT_CASE_LIMIT");
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory create route rejects an empty test contract", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return { module: {} };
  });
  try {
    const response = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({
        name: "processor",
        source: "def run(data):\\n    return data\\n",
        contract: { cases: [] }
      })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "CONTRACT_CASES_REQUIRED");
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory run route forwards JSON input to the isolated worker", async () => {
  let received;
  const server = await startTestServer(async payload => {
    received = payload;
    return { module: { name: "processor", version: 2, result: [6, 8] } };
  });
  try {
    const response = await fetch(`${server.base}/modules/processor/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({ input: [3, 4] })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.module.version, 2);
    assert.deepEqual(body.module.result, [6, 8]);
    assert.deepEqual(received, { action: "run", name: "processor", input: [3, 4] });
  } finally {
    await server.close();
  }
});

test("Software Factory run route requires an input field", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return {};
  });
  try {
    const response = await fetch(`${server.base}/modules/processor/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "RUN_INPUT_REQUIRED");
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("Software Factory run route rejects oversized input before worker invocation", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return {};
  });
  try {
    const response = await fetch(`${server.base}/modules/processor/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "test-admin-key" },
      body: JSON.stringify({ input: "x".repeat(33 * 1024) })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "RUN_INPUT_TOO_LARGE");
    assert.equal(calls, 0);
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
      body: JSON.stringify({ source: "def run(data):\n    return list(data)\n" })
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
    runWorker({ action: "list", padding: "x".repeat(113 * 1024) }),
    error => error instanceof FactoryBridgeError && error.code === "REQUEST_TOO_LARGE"
  );
});

test("worker error status map uses conflict and service-unavailable classes", () => {
  assert.equal(statusForCode("MODULE_ALREADY_EXISTS"), 409);
  assert.equal(statusForCode("SANDBOX_TIMEOUT"), 503);
  assert.equal(statusForCode("SOURCE_SYNTAX_INVALID"), 400);
  assert.equal(statusForCode("TOP_LEVEL_EXECUTION"), 400);
  assert.equal(statusForCode("FORBIDDEN_PATH_WRITE"), 400);
  assert.equal(statusForCode("RUN_INPUT_INVALID"), 400);
  assert.equal(statusForCode("RUN_INPUT_TOO_LARGE"), 413);
  assert.equal(statusForCode("MODULE_OUTPUT_INVALID"), 502);
  assert.equal(statusForCode("MODULE_EXECUTION_FAILED_RUNTIMEERROR"), 422);
});


test("HTTP route completes create/promote/rollback/delete through Python worker and Docker", {
  skip: (() => {
    const result = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 5000 });
    return Boolean(result.error || result.status !== 0);
  })()
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-factory-http-e2e-"));
  const runWorker = createFactoryBridge({
    python: process.env.SOFTWARE_FACTORY_PYTHON || "python3",
    root,
    timeoutMs: 30000
  });
  const server = await startTestServer(runWorker);
  const headers = {
    "content-type": "application/json",
    "X-API-Key": "test-admin-key"
  };
  const sourceV1 = [
    "def run(data):",
    "    if data == 'boom':",
    "        raise RuntimeError('private internal detail')",
    "    return [x * 2 for x in data]",
    ""
  ].join("\n");
  const sourceV2 = ["def run(data):", "    return [x * 3 for x in data]", ""].join("\n");
  const contractV1 = {
    cases: [
      { input: [1, 2], expected: [2, 4] },
      { input: [-3, 0], expected: [-6, 0] }
    ]
  };
  const contractV2 = { cases: [{ input: [1, 2], expected: [3, 6] }] };
  try {
    const blocked = await fetch(`${server.base}/modules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "blocked_processor",
        source: ["print('top-level side effect')", "def run(data):", "    return list(data)", ""].join("\n")
      })
    });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 400);
    assert.equal(blockedBody.error.code, "TOP_LEVEL_EXECUTION");

    const created = await fetch(`${server.base}/modules`, {
      method: "POST", headers, body: JSON.stringify({ name: "http_processor", source: sourceV1, contract: contractV1 })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdBody.module.version, 1);
    assert.equal(createdBody.module.sourceReview.decision, "APPROVED");
    assert.deepEqual(createdBody.module.contract, contractV1);

    const failedRun = await fetch(`${server.base}/modules/http_processor/run`, {
      method: "POST", headers, body: JSON.stringify({ input: "boom" })
    });
    const failedRunBody = await failedRun.json();
    assert.equal(failedRun.status, 422);
    assert.equal(failedRunBody.error.code, "MODULE_EXECUTION_FAILED_RUNTIMEERROR");
    assert.equal(failedRunBody.error.message, "Software Factory operation failed");
    assert.equal(JSON.stringify(failedRunBody).includes("private internal detail"), false);

    const runV1 = await fetch(`${server.base}/modules/http_processor/run`, {
      method: "POST", headers, body: JSON.stringify({ input: [1, 2] })
    });
    const runV1Body = await runV1.json();
    assert.equal(runV1.status, 200);
    assert.deepEqual(runV1Body.module.result, [2, 4]);

    const promoted = await fetch(`${server.base}/modules/http_processor/promote`, {
      method: "POST", headers, body: JSON.stringify({ source: sourceV2, contract: contractV2 })
    });
    const promotedBody = await promoted.json();
    assert.equal(promoted.status, 200);
    assert.equal(promotedBody.module.version, 2);
    assert.equal(promotedBody.module.sourceReview.decision, "APPROVED");
    assert.deepEqual(promotedBody.module.contract, contractV2);

    const runV2 = await fetch(`${server.base}/modules/http_processor/run`, {
      method: "POST", headers, body: JSON.stringify({ input: [1, 2] })
    });
    const runV2Body = await runV2.json();
    assert.equal(runV2.status, 200);
    assert.deepEqual(runV2Body.module.result, [3, 6]);

    const rolledBack = await fetch(`${server.base}/modules/http_processor/rollback`, {
      method: "POST", headers, body: JSON.stringify({})
    });
    const rollbackBody = await rolledBack.json();
    assert.equal(rolledBack.status, 200);
    assert.equal(rollbackBody.module.version, 1);
    assert.equal(rollbackBody.module.rolledBack, true);
    assert.equal(rollbackBody.module.sourceReview.decision, "APPROVED");
    assert.deepEqual(rollbackBody.module.contract, contractV1);

    const runV1Again = await fetch(`${server.base}/modules/http_processor/run`, {
      method: "POST", headers, body: JSON.stringify({ input: [1, 2] })
    });
    const runV1AgainBody = await runV1Again.json();
    assert.equal(runV1Again.status, 200);
    assert.deepEqual(runV1AgainBody.module.result, [2, 4]);

    const listed = await fetch(`${server.base}/modules`, { headers: { "X-API-Key": "test-admin-key" } });
    const listBody = await listed.json();
    assert.equal(listBody.modules.http_processor.version, 1);
    assert.deepEqual(listBody.modules.http_processor.contract, contractV1);

    const deleted = await fetch(`${server.base}/modules/http_processor`, {
      method: "DELETE", headers: { "X-API-Key": "test-admin-key" }
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted, true);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("Software Factory routes rate-limit authenticated callers", async () => {
  let calls = 0;
  const server = await startTestServer(async () => {
    calls += 1;
    return { modules: {} };
  });
  try {
    let response;
    for (let i = 0; i < 10; i += 1) {
      response = await fetch(`${server.base}/modules`, {
        headers: { "X-API-Key": "test-admin-key" }
      });
      assert.equal(response.status, 200);
    }
    response = await fetch(`${server.base}/modules`, {
      headers: { "X-API-Key": "test-admin-key" }
    });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.equal(calls, 10);
  } finally {
    await server.close();
  }
});


const PINNED_IMAGE = "python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b";

test("Factory startup readiness accepts Python, Docker daemon and preloaded pinned image", () => {
  const calls = [];
  assert.doesNotThrow(() => assertFactoryWorkerReady({
    env: { SOFTWARE_FACTORY_PYTHON: "python3", SAMURAI_FACTORY_IMAGE: PINNED_IMAGE },
    spawnSync(command, args) {
      calls.push([command, args]);
      if (command === "python3") return { status: 0 };
      if (args[0] === "info") return { status: 0, stdout: "27.0.1\\n" };
      if (args[0] === "image") return { status: 0 };
      return { status: 1 };
    }
  }));
  assert.equal(calls.length, 3);
});

test("Factory startup refuses mutable sandbox image tags", () => {
  assert.throws(() => assertFactoryWorkerReady({
    env: { SAMURAI_FACTORY_IMAGE: "python:3.12-slim" },
    spawnSync(command, args) {
      if (command === "python3") return { status: 0 };
      if (args[0] === "info") return { status: 0, stdout: "27.0.1\\n" };
      return { status: 0 };
    }
  }), /digest-pinned/);
});

test("Factory startup refuses a sandbox image that is not preloaded", () => {
  assert.throws(() => assertFactoryWorkerReady({
    env: { SAMURAI_FACTORY_IMAGE: PINNED_IMAGE },
    spawnSync(command, args) {
      if (command === "python3") return { status: 0 };
      if (args[0] === "info") return { status: 0, stdout: "27.0.1\\n" };
      if (args[0] === "image") return { status: 1 };
      return { status: 1 };
    }
  }), /not preloaded/);
});

test("Factory feature disabled is always allowed and stays unconfigured", () => {
  assert.equal(assertSoftwareFactoryConfig({
    enabled: false,
    mode: "",
    apiKey: "",
    requestTimeoutMs: 5000
  }), false);
});

test("Factory startup config requires backend API key", () => {
  assert.throws(() => assertSoftwareFactoryConfig({
    enabled: true, mode: "docker", apiKey: "", requestTimeoutMs: 30000
  }), /CORE_API_KEY/);
});

test("Factory startup config requires exact docker mode", () => {
  assert.throws(() => assertSoftwareFactoryConfig({
    enabled: true, mode: "test", apiKey: "server-secret", requestTimeoutMs: 30000
  }), /must be exactly docker/);
});

test("Factory startup config requires a 30 second Core timeout", () => {
  assert.throws(() => assertSoftwareFactoryConfig({
    enabled: true, mode: "docker", apiKey: "server-secret", requestTimeoutMs: 29999
  }), /at least 30000/);
  assert.equal(assertSoftwareFactoryConfig({
    enabled: true, mode: "docker", apiKey: "server-secret", requestTimeoutMs: 30000
  }), true);
});

