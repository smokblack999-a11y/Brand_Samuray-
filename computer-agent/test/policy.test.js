"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTask } = require("../src/policy");

test("accepts a basic HTTPS navigation task", () => {
  const task = validateTask({url:"https://example.com",steps:[{action:"read",target:"h1"}]});
  assert.equal(task.url,"https://example.com/");
});

test("rejects non-HTTPS URLs", () => {
  assert.throws(() => validateTask({url:"http://example.com",steps:[{action:"read",target:"h1"}]}), /HTTPS_URL_REQUIRED/);
});

test("blocks betting and financial action clicks", () => {
  for (const target of ["button:has-text('Place bet')","button:has-text('Withdraw')","button:has-text('Ставка')"]) {
    assert.throws(() => validateTask({url:"https://example.com",steps:[{action:"click",target}]}), /HIGH_IMPACT_ACTION_REQUIRES_OWNER/);
  }
});

test("blocks password and OTP field automation", () => {
  assert.throws(() => validateTask({url:"https://example.com",steps:[{action:"fill",target:"input[name=otp]",value:"123456"}]}), /SENSITIVE_FIELD_OWNER_ONLY/);
});

test("rejects unsupported actions", () => {
  assert.throws(() => validateTask({url:"https://example.com",steps:[{action:"submit"}]}), /UNSUPPORTED_ACTION/);
});
