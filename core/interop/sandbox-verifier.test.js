"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { verifyCommand, verificationGate } = require("./sandbox-verifier");

const cwd = path.resolve(__dirname, "../..");

test("passes a successful isolated command", async () => {
  const result = await verifyCommand(process.execPath, ["-e", "process.exit(0)"], { cwd, timeoutMs: 5000 });
  assert.equal(result.passed, true);
  assert.equal(verificationGate(result), true);
});

test("fails a non-zero command", async () => {
  const result = await verifyCommand(process.execPath, ["-e", "process.exit(2)"], { cwd, timeoutMs: 5000 });
  assert.equal(result.passed, false);
  assert.equal(verificationGate(result), false);
});
