"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSandboxAdapter } = require("./sandbox-adapter");

test("blocks commands outside allowlist", async () => {
  const sandbox = createSandboxAdapter({ run: async () => ({ passed: true }), allowCommands: ["node --check a.js"] });
  assert.equal((await sandbox({ mission: {}, plan: {}, candidate: { test_commands: ["rm -rf /"] } })).passed, false);
});

test("runs only allowlisted commands", async () => {
  const sandbox = createSandboxAdapter({ run: async x => ({ passed: true, commands: x.commands }), allowCommands: ["node --check a.js"] });
  const result = await sandbox({ mission: {}, plan: {}, candidate: { test_commands: ["node --check a.js"] } });
  assert.equal(result.passed, true);
});
