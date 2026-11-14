"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVisionService, validateImageBuffer } = require("./vision-service");

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("validates JPEG, PNG and WEBP signatures", () => {
  assert.equal(validateImageBuffer(jpeg, "image/jpeg").mimeType, "image/jpeg");
  assert.equal(validateImageBuffer(png, "image/png").mimeType, "image/png");
  assert.equal(validateImageBuffer(Buffer.from("RIFF0000WEBP"), "image/webp").mimeType, "image/webp");
});

test("rejects empty, oversized, unsupported and mismatched images", () => {
  assert.throws(() => validateImageBuffer(Buffer.alloc(0), "image/jpeg"), { code: "EMPTY_IMAGE" });
  assert.throws(() => validateImageBuffer(jpeg, "image/gif"), { code: "UNSUPPORTED_IMAGE_TYPE" });
  assert.throws(() => validateImageBuffer(jpeg, "image/png"), { code: "IMAGE_SIGNATURE_MISMATCH" });
  assert.throws(() => validateImageBuffer(jpeg, "image/jpeg", 3), { code: "IMAGE_TOO_LARGE" });
});

test("sends a validated image to Responses API as a high-detail data URL", async () => {
  let request;
  const service = createVisionService({
    apiKey: "test-key",
    model: "test-vision-model",
    clientFactory: () => ({ responses: { create: async (value) => { request = value; return { output_text: "Обнаружен предмет." }; } } })
  });
  const result = await service.analyze({ buffer: jpeg, contentType: "image/jpeg", prompt: "Что видно?" });
  assert.equal(result.analysis, "Обнаружен предмет.");
  assert.equal(request.model, "test-vision-model");
  assert.equal(request.input[0].content[1].detail, "high");
  assert.equal(request.input[0].content[1].image_url, "data:image/jpeg;base64," + jpeg.toString("base64"));
  assert.match(request.instructions, /Не подтверждай подлинность документов/);
});

test("requires an API key and a configured vision-capable model", async () => {
  const noKey = createVisionService({ apiKey: "", model: "model", clientFactory: () => ({}) });
  await assert.rejects(() => noKey.analyze({ buffer: jpeg, contentType: "image/jpeg" }), { code: "OPENAI_API_KEY_MISSING" });
  const noModel = createVisionService({ apiKey: "test-key", model: "", clientFactory: () => ({}) });
  await assert.rejects(() => noModel.analyze({ buffer: jpeg, contentType: "image/jpeg" }), { code: "VISION_MODEL_MISSING" });
});

test("rejects an empty provider response and oversized prompt", async () => {
  const empty = createVisionService({ apiKey: "test-key", model: "model", clientFactory: () => ({ responses: { create: async () => ({ output_text: " " }) } }) });
  await assert.rejects(() => empty.analyze({ buffer: jpeg, contentType: "image/jpeg" }), { code: "EMPTY_VISION_RESPONSE" });
  await assert.rejects(() => empty.analyze({ buffer: jpeg, contentType: "image/jpeg", prompt: "x".repeat(1001) }), { code: "PROMPT_TOO_LONG" });
});
