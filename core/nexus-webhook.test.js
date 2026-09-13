"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { verifyGitHubSignature } = require("./nexus-webhook");

test("GitHub HMAC signature accepts authentic payload", () => {
  const raw = JSON.stringify({ action: "completed" });
  const secret = "test-secret";
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyGitHubSignature(raw, signature, secret), true);
  assert.equal(verifyGitHubSignature(raw, `${signature}x`, secret), false);
  assert.equal(verifyGitHubSignature(raw, signature, "wrong-secret"), false);
});
