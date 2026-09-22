"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runSandbox } = require("./nexus-sandbox");

test("sandbox runs commands and returns evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-fixture-"));
  await fs.writeFile(path.join(root, "fixture.txt"), "ok\n");
  try {
    const result = await runSandbox({
      workspace: root,
      commands: [["node", "-e", "console.log(require('fs').readFileSync('fixture.txt','utf8').trim())"]]
    });
    assert.equal(result.passed, true);
    assert.equal(result.commands[0].code, 0);
    assert.match(result.commands[0].stdout, /ok/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sandbox stops on first failed command", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-fixture-"));
  try {
    const result = await runSandbox({
      workspace: root,
      commands: [
        ["node", "-e", "process.exit(7)"],
        ["node", "-e", "process.exit(0)"]
      ]
    });
    assert.equal(result.passed, false);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].code, 7);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sandbox kills timed-out command", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-fixture-"));
  try {
    const result = await runSandbox({
      workspace: root,
      timeoutMs: 50,
      commands: [["node", "-e", "setTimeout(()=>{},1000)"]]
    });
    assert.equal(result.passed, false);
    assert.equal(result.commands[0].timedOut, true);
    assert.equal(result.commands[0].code, 124);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});