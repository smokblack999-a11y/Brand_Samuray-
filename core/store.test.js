"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-core-store-"));
process.env.DATA_DIR = dataDir;
const store = require("./store");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("lead storage uses private directory and file permissions", () => {
  store.saveLead({ message: "confidential customer message", source: "unit-test" });
  const directoryMode = fs.statSync(dataDir).mode & 0o777;
  const fileMode = fs.statSync(path.join(dataDir, "leads.json")).mode & 0o777;
  assert.equal(directoryMode, 0o700);
  assert.equal(fileMode, 0o600);
});

test("event claims remain idempotent and failed events can be retried", () => {
  const first = store.claimEvent("telegram:test:event");
  const duplicate = store.claimEvent("telegram:test:event");
  assert.equal(first.claimed, true);
  assert.equal(duplicate.claimed, false);
  store.updateLead(first.item.id, { status: "failed" });
  const retry = store.claimEvent("telegram:test:event");
  assert.equal(retry.claimed, true);
});
