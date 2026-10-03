"use strict";

process.env.NODE_ENV = "test";
process.env.CORE_API_KEY = "test-admin-key";
process.env.DATA_DIR = require("path").join(__dirname, ".test-x10-data");

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createX10Router } = require("./x10-control");

const DATA_DIR = process.env.DATA_DIR;
fs.rmSync(DATA_DIR, { recursive: true, force: true });

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/x10", createX10Router());
  return server;
}

async function request(appInstance, method, url, body, headers = {}) {
  const server = appInstance.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("X10 control plane registers an agent and authenticates it", async () => {
  const application = app();

  const created = await request(
    application,
    "POST",
    "/api/x10/admin/agents",
    { id: "camera-01", targetPackage: "com.pas.webcam" },
    { "X-API-Key": "test-admin-key" }
  );

  assert.equal(created.status, 201);
  assert.equal(created.body.ok, true);
  assert.equal(typeof created.body.token, "string");
  assert.equal(created.body.token.length >= 32, true);

  const heartbeat = await request(
    application,
    "POST",
    "/api/x10/agent/camera-01/heartbeat",
    { status: "OK", version: "0.1.0" },
    { Authorization: `Bearer ${created.body.token}` }
  );

  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.body.ok, true);

  const denied = await request(
    application,
    "GET",
    "/api/x10/agent/camera-01/commands",
    undefined,
    { Authorization: "Bearer wrong-token" }
  );
  assert.equal(denied.status, 401);
});

test("restart is queued and delivered exactly once", async () => {
  const application = app();

  const created = await request(
    application,
    "POST",
    "/api/x10/admin/agents",
    { id: "camera-02" },
    { "X-API-Key": "test-admin-key" }
  );

  const queued = await request(
    application,
    "POST",
    "/api/x10/admin/agents/camera-02/restart",
    { reason: "health-failure" },
    { "X-API-Key": "test-admin-key" }
  );

  assert.equal(queued.status, 202);

  const first = await request(
    application,
    "GET",
    "/api/x10/agent/camera-02/commands",
    undefined,
    { Authorization: `Bearer ${created.body.token}` }
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.command.action, "restart_app");

  const second = await request(
    application,
    "GET",
    "/api/x10/agent/camera-02/commands",
    undefined,
    { Authorization: `Bearer ${created.body.token}` }
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.command, null);
});
