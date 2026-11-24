"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-store-test-"));
process.env.DATA_DIR = tempDir;
const store = require("./store");

test("saveLead keeps generated id, timestamp and status from being overwritten by input", () => {
  const lead = store.saveLead({
    id: "attacker-controlled-id",
    createdAt: "1900-01-01T00:00:00.000Z",
    status: "failed",
    name: "Test Lead",
    score: 72
  });
  assert.notEqual(lead.id, "attacker-controlled-id");
  assert.notEqual(lead.createdAt, "1900-01-01T00:00:00.000Z");
  assert.equal(lead.status, "completed");
  assert.equal(lead.name, "Test Lead");
});

test("claimEvent controls identity, timestamps, status and eventKey", () => {
  const result = store.claimEvent("trusted-event-key", {
    id: "spoofed-id",
    eventKey: "spoofed-event",
    status: "completed",
    createdAt: "1900-01-01",
    updatedAt: "1900-01-01",
    name: "Webhook lead"
  });
  assert.equal(result.claimed, true);
  assert.notEqual(result.item.id, "spoofed-id");
  assert.equal(result.item.eventKey, "trusted-event-key");
  assert.equal(result.item.status, "processing");
  assert.notEqual(result.item.createdAt, "1900-01-01");
});

test("updateLead cannot alter immutable identity fields", () => {
  const created = store.saveLead({ eventKey: "update-test", name: "Before" });
  const updated = store.updateLead(created.id, {
    id: "replacement-id",
    createdAt: "1900-01-01",
    eventKey: "replacement-event",
    name: "After",
    status: "processing"
  });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.eventKey, "update-test");
  assert.equal(updated.name, "After");
  assert.equal(updated.status, "processing");
});
