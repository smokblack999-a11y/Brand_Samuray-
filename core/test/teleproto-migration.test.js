"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("teleproto exposes the GramJS-compatible MTProto entry points", () => {
  const { TelegramClient } = require("teleproto");
  const { StringSession } = require("teleproto/sessions");

  assert.equal(typeof TelegramClient, "function");
  assert.equal(typeof StringSession, "function");

  for (const method of ["connect", "disconnect", "start", "getMe", "getDialogs", "getMessages", "sendMessage", "sendFile"]) {
    assert.equal(typeof TelegramClient.prototype[method], "function", `TelegramClient.${method} must exist`);
  }

  const session = new StringSession("");
  assert.equal(typeof session.save, "function");
  assert.equal(session.save(), "");
});
