"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessIntent } = require("./intent-firewall");

test("allows a scoped test change", () => {
  const r = assessIntent({
    intent: "fix flaky test",
    changedFiles: ["tests/parser.test.js", "src/parser.js"]
  });
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.risk, "low");
});

test("blocks sensitive auth change for unrelated intent", () => {
  const r = assessIntent({
    intent: "fix flaky test",
    changedFiles: ["tests/login.test.js", "src/auth/session.js"]
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasons.includes("UNEXPECTED_SENSITIVE_CHANGE"));
});

test("blocks workflow permission changes for ordinary code intent", () => {
  const r = assessIntent({
    intent: "fix parser bug",
    changedFiles: [".github/workflows/release.yml"]
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.actualCapabilities.includes("CI_WORKFLOW"));
});

test("permits authentication intent to touch auth", () => {
  const r = assessIntent({
    intent: "fix authentication timeout",
    changedFiles: ["src/auth/session.js"]
  });
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.risk, "critical");
});

test("requires human review when intent is missing", () => {
  const r = assessIntent({ changedFiles: ["src/app.js"] });
  assert.equal(r.decision, "HUMAN_REVIEW");
  assert.ok(r.reasons.includes("INTENT_REQUIRED"));
});

test("enforces explicit allowed paths", () => {
  const r = assessIntent({
    intent: "fix parser",
    allowedPaths: ["src/parser"],
    changedFiles: ["src/parser/index.js", "src/other.js"]
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.outOfScope.includes("src/other.js"));
});
