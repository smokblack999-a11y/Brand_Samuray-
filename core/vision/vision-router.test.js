"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createVisionRouter } = require("./vision-router");

async function withServer(t, router, run) {
  const app = express();
  app.use("/api/vision", router);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  return run("http://127.0.0.1:" + address.port);
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const passRateLimit = (_req, _res, next) => next();

test("Vision endpoint is disabled by default", async (t) => {
  await withServer(t, createVisionRouter({ enabled: false, rateLimiter: passRateLimit }), async (base) => {
    const response = await fetch(base + "/api/vision/analyze", { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Vision-Consent": "true" }, body: jpeg });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "VISION_DISABLED");
  });
});

test("Vision endpoint requires explicit cloud-analysis consent", async (t) => {
  await withServer(t, createVisionRouter({ enabled: true, rateLimiter: passRateLimit, service: { analyze: async () => ({ analysis: "unused" }) } }), async (base) => {
    const response = await fetch(base + "/api/vision/analyze", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VISION_CONSENT_REQUIRED");
  });
});

test("Vision endpoint accepts a consented JPEG and returns analysis", async (t) => {
  let received;
  const service = { analyze: async (input) => { received = input; return { analysis: "Вижу коробку.", model: "test-model" }; } };
  await withServer(t, createVisionRouter({ enabled: true, rateLimiter: passRateLimit, service }), async (base) => {
    const response = await fetch(base + "/api/vision/analyze", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Vision-Consent": "true", "X-Vision-Prompt": "Describe the object." },
      body: jpeg
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).analysis, "Вижу коробку.");
    assert.equal(received.contentType, "image/jpeg");
    assert.equal(received.prompt, "Describe the object.");
    assert.deepEqual(received.buffer, jpeg);
  });
});

test("Vision endpoint rejects unsupported image media types", async (t) => {
  await withServer(t, createVisionRouter({ enabled: true, rateLimiter: passRateLimit, service: { analyze: async () => ({}) } }), async (base) => {
    const response = await fetch(base + "/api/vision/analyze", { method: "POST", headers: { "Content-Type": "image/gif", "X-Vision-Consent": "true" }, body: Buffer.from("GIF89a") });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, "UNSUPPORTED_IMAGE_TYPE");
  });
});
