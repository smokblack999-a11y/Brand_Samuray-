"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const claims = require("./revenue-execution-claims");

test("exclusive claim allows only one winner for the same tenant and execution", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-claims-"));
  try {
    const first = claims.acquire("tenant-a", "exec-1", {}, { directory });
    const second = claims.acquire("tenant-a", "exec-1", {}, { directory });
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.equal(second.record.status, "STARTED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("claims are tenant scoped", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-claims-"));
  try {
    assert.equal(claims.acquire("tenant-a", "exec-1", {}, { directory }).acquired, true);
    assert.equal(claims.acquire("tenant-b", "exec-1", {}, { directory }).acquired, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("claim completion is durable and cannot be silently reacquired", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-claims-"));
  try {
    claims.acquire("tenant-a", "exec-1", {}, { directory });
    const completed = claims.complete("tenant-a", "exec-1", "UNKNOWN", { code: "ECONNRESET" }, { directory });
    assert.equal(completed.status, "UNKNOWN");
    assert.equal(claims.read("tenant-a", "exec-1", { directory }).details.code, "ECONNRESET");
    assert.equal(claims.acquire("tenant-a", "exec-1", {}, { directory }).acquired, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid claim inputs and status are rejected", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-claims-"));
  try {
    assert.throws(() => claims.acquire("", "exec-1", {}, { directory }), /tenantId is required/);
    assert.throws(() => claims.acquire("tenant-a", "", {}, { directory }), /executionId is required/);
    assert.throws(() => claims.complete("tenant-a", "exec-1", "RETRY", {}, { directory }), /invalid execution claim status/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
