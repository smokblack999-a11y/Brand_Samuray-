"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const ledgerPath = path.join(repoRoot, "core", "revenue-ledger.js");

function runWorker(dataDir, script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, DATA_DIR: dataDir }
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error("worker exited " + code + ": " + stderr));
      else resolve();
    });
  });
}

test("concurrent writers preserve every unique outcome and evidence chain", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-revenue-race-"));
  const workers = [];
  const script = [
    "const ledger = require(process.argv[1]);",
    "const worker = Number(process.argv[2]);",
    "const count = Number(process.argv[3]);",
    "for (let i = 0; i < count; i++) {",
    "  ledger.appendOutcome({",
    "    tenantId: 'race-tenant',",
    "    eventId: 'event-' + worker + '-' + i,",
    "    status: 'WON',",
    "    attributableRevenueKZT: 1000,",
    "    attributableGrossProfitKZT: 300",
    "  });",
    "}"
  ].join("\n");

  for (let worker = 0; worker < 8; worker++) {
    workers.push(runWorker(dataDir, script, [ledgerPath, worker, 25]));
  }
  await Promise.all(workers);

  const ledger = require(ledgerPath);
  const rows = ledger.list("race-tenant", "OUTCOME");
  assert.equal(rows.length, 200);
  assert.equal(new Set(rows.map(x => x.eventId)).size, 200);
  assert.equal(ledger.integrity("race-tenant").valid, true);
});

test("concurrent duplicate outcome is inserted exactly once", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-revenue-dedupe-"));
  const workers = [];
  const script = [
    "const ledger = require(process.argv[1]);",
    "ledger.appendOutcome({",
    "  tenantId: 'dedupe-tenant',",
    "  eventId: 'same-event',",
    "  status: 'WON',",
    "  attributableRevenueKZT: 5000,",
    "  attributableGrossProfitKZT: 1500",
    "});"
  ].join("\n");

  for (let worker = 0; worker < 16; worker++) {
    workers.push(runWorker(dataDir, script, [ledgerPath]));
  }
  await Promise.all(workers);

  const ledger = require(ledgerPath);
  const rows = ledger.list("dedupe-tenant", "OUTCOME");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventId, "same-event");
  assert.equal(ledger.integrity("dedupe-tenant").valid, true);
});

test("execution idempotency survives concurrent retries", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-revenue-exec-"));
  const workers = [];
  const script = [
    "const ledger = require(process.argv[1]);",
    "ledger.appendExecution({",
    "  tenantId: 'execution-tenant',",
    "  executionId: 'execution-42',",
    "  decisionId: 'decision-42',",
    "  action: 'RESPOND',",
    "  status: 'EXECUTED'",
    "});"
  ].join("\n");

  for (let worker = 0; worker < 12; worker++) {
    workers.push(runWorker(dataDir, script, [ledgerPath]));
  }
  await Promise.all(workers);

  const ledger = require(ledgerPath);
  const rows = ledger.list("execution-tenant", "EXECUTION");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].executionId, "execution-42");
  assert.equal(ledger.integrity("execution-tenant").valid, true);
});
