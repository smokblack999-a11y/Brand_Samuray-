"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSessionStore } = require("../src/session-store");

test("session is encrypted at rest and round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-core-"));
  const filePath = path.join(dir, "session.enc");
  const key = Buffer.alloc(32, 7);
  const store = createSessionStore({ filePath, key });
  const session = "sensitive-telegram-session-string";
  store.save(session);
  const onDisk = fs.readFileSync(filePath, "utf8");
  assert.equal(onDisk.includes(session), false);
  assert.equal(store.load(), session);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tampered encrypted session fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-core-"));
  const filePath = path.join(dir, "session.enc");
  const store = createSessionStore({ filePath, key: Buffer.alloc(32, 9) });
  store.save("another-sensitive-session");
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  payload.ciphertext = Buffer.from("tampered").toString("base64");
  fs.writeFileSync(filePath, JSON.stringify(payload));
  assert.throws(() => store.load());
  fs.rmSync(dir, { recursive: true, force: true });
});

test("invalid encryption key length is rejected", () => {
  assert.throws(() => createSessionStore({ filePath: "/tmp/session.enc", key: Buffer.alloc(8) }), /32 bytes/);
});
