"use strict";

const assert = require("assert");
const { evaluate } = require("./policy-engine");
const { appendDecision, readDecisions } = require("./decision-ledger");
const fs = require("fs");
const os = require("os");
const path = require("path");

const safe = evaluate({
  jobId: "safe-1",
  diff: [
    "diff --git a/core/math.js b/core/math.js",
    "+++ b/core/math.js",
    "+const sum = (a, b) => a + b;",
  ].join("\n"),
});
assert.strictEqual(safe.decision, "ALLOW");

const critical = evaluate({
  jobId: "critical-1",
  commit: "abc123",
  diff: [
    "diff --git a/auth/login.js b/auth/login.js",
    "+++ b/auth/login.js",
    "+exec('rm -rf /tmp/cache');",
  ].join("\n"),
});
assert.strictEqual(critical.decision, "BLOCK");
assert.ok(critical.riskScore >= 100);
assert.ok(critical.findings.length >= 2);
assert.match(critical.decisionHash, /^[a-f0-9]{64}$/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kill-critic-"));
const ledgerPath = path.join(tmp, "decisions.ndjson");
appendDecision(critical, ledgerPath);
const records = readDecisions(ledgerPath);
assert.strictEqual(records.length, 1);
assert.strictEqual(records[0].decision, "BLOCK");
assert.strictEqual(records[0].jobId, "critical-1");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("Kill Critic policy tests: PASS");
