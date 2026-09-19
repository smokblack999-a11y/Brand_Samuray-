"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePatch, safeTestCommands, repairBranchName } = require("./github-agent-patcher");

test("patcher rejects traversal and protected paths", () => {
  assert.throws(() => normalizePatch({ patches: [{ path: "../x", content: "x" }] }), /Unsafe patch path/);
  assert.throws(() => normalizePatch({ patches: [{ path: ".env", content: "x" }] }), /Denied patch path/);
});

test("patcher allowlists test commands", () => {
  assert.deepEqual(safeTestCommands(["npm test"]), ["npm test"]);
  assert.throws(() => safeTestCommands(["rm -rf ."]), /allowlisted/);
});

test("repair branch names are deterministic and isolated", () => {
  const a = repairBranchName("job-123");
  assert.equal(a, repairBranchName("job-123"));
  assert.match(a, /^repair\/x18-[a-f0-9]{12}$/);
});
