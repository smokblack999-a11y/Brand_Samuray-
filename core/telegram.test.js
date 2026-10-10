"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const TELEGRAM_ENV = ["TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION"];

function withMissingTelegramConfig(run) {
  const saved = new Map(TELEGRAM_ENV.map((key) => [key, process.env[key]]);
  for (const key of TELEGRAM_ENV) process.env[key] = "";
  try {
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Telegram user module exports the Android photo-send operation", () => {
  const telegram = require("./telegram");
  assert.equal(typeof telegram.sendPhotoBase64, "function");
});

test("Telegram API fails closed with a typed error when the user session is not configured", async () => {
  await withMissingTelegramConfig(async () => {
    const telegram = require("./telegram");
    await assert.rejects(
      telegram.getMe(),
      (error) => error && error.code === "TELEGRAM_NOT_CONFIGURED"
    );
  });
});

test("photo-send validates chat id and Base64 before attempting network access", async () => {
  const telegram = require("./telegram");

  await assert.rejects(
    telegram.sendPhotoBase64({ chatId: "", base64: "aGVsbG8=" }),
    (error) => error && error.code === "INVALID_CHAT_ID"
  );
  await assert.rejects(
    telegram.sendPhotoBase64({ chatId: "123", base64: "" }),
    (error) => error && error.code === "INVALID_PHOTO"
  );
  await assert.rejects(
    telegram.sendPhotoBase64({ chatId: "123", base64: "not base64!" }),
    (error) => error && error.code === "INVALID_PHOTO"
  );
});
