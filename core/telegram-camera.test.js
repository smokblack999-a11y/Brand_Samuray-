"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TELEGRAM_BOT_TOKEN = "123:test-token";

const telegramCamera = require("./telegram-camera");

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

test("sendMessage uses Telegram Bot API", async () => {
  let request;
  const restore = mockFetch(async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  try {
    const result = await telegramCamera.sendMessage({ chatId: "123", message: "hello" });
    assert.equal(result.message_id, 7);
    assert.equal(request.url, "https://api.telegram.org/bot123:test-token/sendMessage");
    assert.equal(JSON.parse(request.options.body).chat_id, "123");
  } finally {
    restore();
  }
});

test("sendPhoto sends multipart photo and location when GPS exists", async () => {
  const calls = [];
  const restore = mockFetch(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  try {
    const result = await telegramCamera.sendPhoto({
      chatId: "-1001",
      fileName: "photo.jpg",
      caption: "SamuraiOS",
      base64: Buffer.from("jpeg-bytes").toString("base64"),
      latitude: 43.2389,
      longitude: 76.8897
    });
    assert.equal(result.message_id, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/sendPhoto$/);
    assert.match(calls[1].url, /\/sendLocation$/);
    const locationBody = JSON.parse(calls[1].options.body);
    assert.equal(locationBody.chat_id, "-1001");
    assert.equal(locationBody.latitude, 43.2389);
    assert.equal(locationBody.longitude, 76.8897);
  } finally {
    restore();
  }
});

test("sendPhoto rejects empty or oversized payloads", async () => {
  await assert.rejects(
    () => telegramCamera.sendPhoto({ chatId: "1", base64: "" }),
    /base64 photo is required/
  );
  await assert.rejects(
    () => telegramCamera.sendPhoto({
      chatId: "1",
      base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")
    }),
    /exceeds 10 MB/
  );
});
