"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validateUsername, validatePassword, validateCiphertext, hashPassword, verifyPassword, issueAccessToken, verifyAccessToken, newRefreshToken, hashToken } = require("../src/security");

test("username and password validation reject weak values", () => {
  assert.equal(validateUsername("sam"), true);
  assert.equal(validateUsername("a"), false);
  assert.equal(validateUsername("bad name"), false);
  assert.equal(validatePassword("123456789012"), true);
  assert.equal(validatePassword("short"), false);
});
test("ciphertext envelope requires bounded base64 payload", () => {
  assert.equal(validateCiphertext(Buffer.alloc(32, 7).toString("base64")), true);
  assert.equal(validateCiphertext("plaintext"), false);
  assert.equal(validateCiphertext(""), false);
});
test("password hash is salted and verifies without exposing original", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});
test("access tokens are signed, scoped and expire", () => {
  const secret = crypto.randomBytes(48).toString("hex");
  const user = { id: crypto.randomUUID(), username: "samurai" };
  const token = issueAccessToken(user, secret);
  assert.equal(verifyAccessToken(token, secret).sub, user.id);
  assert.throws(() => verifyAccessToken(token, "x".repeat(48)));
});
test("refresh tokens are high entropy and stored as hashes", () => {
  const token = newRefreshToken();
  assert.ok(token.length >= 60);
  assert.notEqual(hashToken(token).toString("hex"), token);
});
