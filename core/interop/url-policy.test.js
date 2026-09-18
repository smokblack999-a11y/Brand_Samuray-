"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFetchUrl } = require("./url-policy");

test("allows normal HTTPS URLs", () => {
  assert.equal(validateFetchUrl("https://example.com/api").ok, true);
});

test("blocks localhost and private IPv4 targets", () => {
  assert.equal(validateFetchUrl("https://localhost/health").code, "PRIVATE_HOST_BLOCKED");
  assert.equal(validateFetchUrl("https://127.0.0.1:6379/").code, "PRIVATE_HOST_BLOCKED");
  assert.equal(validateFetchUrl("https://10.0.0.5/").code, "PRIVATE_HOST_BLOCKED");
  assert.equal(validateFetchUrl("https://192.168.1.5/").code, "PRIVATE_HOST_BLOCKED");
});

test("blocks non-HTTPS protocols and URL credentials", () => {
  assert.equal(validateFetchUrl("http://example.com/").code, "PROTOCOL_NOT_ALLOWED");
  assert.equal(validateFetchUrl("https://user:pass@example.com/").code, "CREDENTIALS_IN_URL");
});
