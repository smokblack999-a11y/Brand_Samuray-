"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeDiff } = require("../x10thinc-diff-critic");

test("blocks secret literals", () => {
  const r = analyzeDiff('+++ b/core/config.js\n+const api_key = "sk-test-1234567890";');
  assert.equal(r.safe, false);
  assert.ok(r.criticalCount > 0);
});

test("blocks auth bypass", () => {
  const r = analyzeDiff('+++ b/core/auth/middleware.js\n+function verify() { return true; }');
  assert.equal(r.safe, false);
});

test("blocks deleted assertions", () => {
  const r = analyzeDiff('--- a/core/test/recovery.test.js\n-assert.equal(result, expected);\n+++ b/core/test/recovery.test.js\n+console.log(result);');
  assert.equal(r.safe, false);
  assert.equal(r.deletedAssertions, 1);
});

test("blocks workflow privilege changes", () => {
  const r = analyzeDiff('+++ b/.github/workflows/recovery.yml\n+  contents: write');
  assert.equal(r.safe, false);
});

test("accepts a minimal safe diff", () => {
  const r = analyzeDiff('--- a/core/app.js\n+++ b/core/app.js\n@@\n-const broken = ;\n+const fixed = true;');
  assert.equal(r.safe, true);
});
