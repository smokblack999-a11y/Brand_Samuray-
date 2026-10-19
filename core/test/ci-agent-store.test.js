"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCiAgentStore } = require("../ci-agent-store");

test("CI-AGENT store atomically saves and reloads bounded state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-store-"));
  try {
    const store = createCiAgentStore({ dataDir: dir });
    const snapshot = {
      events: [{ id: "123", analysis: { status: "queued", attempts: 0 } }],
      deliveries: ["delivery-1"]
    };
    store.save(snapshot);
    assert.deepEqual(store.load(), snapshot);
    assert.equal(fs.existsSync(store.filePath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CI-AGENT store fails closed on corrupt state instead of silently resetting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-store-"));
  try {
    const store = createCiAgentStore({ dataDir: dir });
    fs.writeFileSync(store.filePath, "{broken", "utf8");
    assert.throws(() => store.load(), { code: "CI_AGENT_STATE_CORRUPT" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
