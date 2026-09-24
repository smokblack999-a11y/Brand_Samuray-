"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseUnifiedDiff,
  isCriticalPath,
  scoreRisk,
  evaluateInvariants,
  decide,
  analyzePatch
} = require("./kill-critic");

const diff = [
  "diff --git a/auth/login.js b/auth/login.js",
  "--- a/auth/login.js",
  "+++ b/auth/login.js",
  "@@",
  "+const token = process.env.TOKEN;",
  "+if (!verify(token)) throw new Error('bad token');"
].join("\n");

test("parses changed files and line counts", () => {
  const r = parseUnifiedDiff(diff);
  assert.equal(r.files.length, 1);
  assert.equal(r.additions, 2);
  assert.equal(r.deletions, 0);
});

test("recognizes critical security paths", () => {
  assert.equal(isCriticalPath("auth/login.js"), true);
  assert.equal(isCriticalPath("src/ui.js"), false);
});

test("risk engine detects critical path changes", () => {
  const r = scoreRisk(parseUnifiedDiff(diff));
  assert.ok(r.score >= 12);
  assert.ok(r.reasons.includes("CRITICAL_PATH_CHANGED"));
});

test("invariant engine blocks a forbidden security change", () => {
  const r = evaluateInvariants({
    diff: "+rejectUnauthorized: false",
    invariants: [
      { id: "tls-verification", pattern: /rejectUnauthorized\s*:\s*false/i, description: "TLS verification must remain enabled" }
    ]
  });
  assert.equal(r.passed, false);
  assert.equal(r.results[0].status, "fail");
});

test("decision is fail-closed when proof is incomplete", () => {
  assert.equal(decide({
    risk: 0,
    invariantsPassed: true,
    sandboxPassed: true,
    testsPassed: true,
    ciPassed: true,
    evidenceComplete: false
  }), "ESCALATE");
});

test("decision kills a critical invariant violation", () => {
  assert.equal(decide({
    risk: 20,
    invariantsPassed: false,
    sandboxPassed: true,
    testsPassed: true,
    ciPassed: true,
    evidenceComplete: true
  }), "KILL");
});

test("full analysis produces a proof receipt", () => {
  const r = analyzePatch({
    diff,
    sandboxPassed: true,
    testsPassed: true,
    ciPassed: true,
    invariants: [{ id: "no-tls-disable", pattern: /rejectUnauthorized\s*:\s*false/i }],
    evidence: {
      patch: "patch-hash",
      sandbox: "sandbox-pass",
      tests: "tests-pass",
      ci: "ci-pass"
    }
  });
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.receipt.version, "x10thinc-proof-v1");
  assert.equal(typeof r.receipt.diffHash, "string");
});
