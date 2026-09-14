"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classify, redact, excerptLines } = require("./diagnoser");

test("classify detects concrete CI log failures", () => {
  assert.equal(classify("AssertionError: expected 1 to equal 2"), "test_failure");
  assert.equal(classify("npm ERR! code ERESOLVE"), "dependency_error");
  assert.equal(classify("Error: ENOSPC: no space left on device"), "disk_full");
  assert.equal(classify("SyntaxError: Unexpected token"), "syntax_error");
});

test("redact removes common credentials from evidence", () => {
  const value = redact("Authorization: Bearer ghs_123456 token=abc123 sk-secret");
  assert.equal(value.includes("ghs_123456"), false);
  assert.equal(value.includes("sk-secret"), false);
  assert.equal(value.includes("abc123"), false);
});

test("excerptLines keeps bounded context around concrete errors", () => {
  const excerpts = excerptLines("ok\nok\nAssertionError: boom\nok\nok");
  assert.equal(excerpts.length, 1);
  assert.match(excerpts[0].text, /AssertionError/);
});
