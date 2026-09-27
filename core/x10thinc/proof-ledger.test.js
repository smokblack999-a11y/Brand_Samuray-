"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("proof ledger is tamper-evident and hash chained", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x10-ledger-"));
  const file = path.join(dir, "ledger.jsonl");
  const previous = process.env.NEXUS_LEDGER_PATH;
  process.env.NEXUS_LEDGER_PATH = file;
  try {
    const ledgerPath = require.resolve("./proof-ledger");
    delete require.cache[ledgerPath];
    const ledger = require("./proof-ledger");
    ledger.append({ type: "recovery.verification", jobId: "recovery-test", diffHash: "abc" });
    ledger.append({ type: "recovery.verification", jobId: "recovery-test-2", diffHash: "def" });
    assert.equal(ledger.verify().passed, true);
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    const record = JSON.parse(lines[0]);
    record.receipt.diffHash = "tampered";
    lines[0] = JSON.stringify(record);
    fs.writeFileSync(file, lines.join("\n") + "\n");
    assert.equal(ledger.verify().passed, false);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_LEDGER_PATH;
    else process.env.NEXUS_LEDGER_PATH = previous;
  }
});
