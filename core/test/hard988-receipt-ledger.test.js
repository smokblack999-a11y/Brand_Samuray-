"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { appendReceipt, verifyLedger } = require("../hard988-receipt-ledger");

test("receipt ledger appends a verifiable hash chain", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hard988-ledger-"));
  const file = path.join(dir, "receipts.jsonl");
  const receipt1 = { decision: "BLOCK", receiptHash: "a".repeat(64) };
  const receipt2 = { decision: "READY_FOR_HUMAN_REVIEW", receiptHash: "b".repeat(64) };
  try {
    const first = await appendReceipt(file, receipt1);
    const second = await appendReceipt(file, receipt2);
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(second.previousHash, first.entryHash);
    assert.deepEqual(await verifyLedger(file), {
      valid: true, entries: 2, headHash: second.entryHash
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("receipt ledger detects modified historical entries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hard988-ledger-tamper-"));
  const file = path.join(dir, "receipts.jsonl");
  try {
    await appendReceipt(file, { decision: "BLOCK", receiptHash: "c".repeat(64) });
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
    const entry = JSON.parse(lines[0]);
    entry.receipt.decision = "READY_FOR_HUMAN_REVIEW";
    await fs.writeFile(file, JSON.stringify(entry) + "\n");
    const result = await verifyLedger(file);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "entry_hash_mismatch");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("receipt ledger rejects malformed receipts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hard988-ledger-invalid-"));
  try {
    await assert.rejects(
      appendReceipt(path.join(dir, "receipts.jsonl"), { decision: "PASS", receiptHash: "bad" }),
      /hard988_receipt_invalid/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
