"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("preflight script is syntax-valid", () => {
  const file = path.join(__dirname, "nexus-recovery-preflight.js");
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  assert.ok(true);
});
