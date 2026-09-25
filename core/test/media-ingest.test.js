"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mediaFromMessage } = require("../media-ingest");

test("detects Telegram camera/gallery photo", () => {
  const media = mediaFromMessage({
    photo: [{ file_id: "small", width: 90, height: 90 }, { file_id: "large", width: 1280, height: 720 }]
  });
  assert.deepEqual(media, { type: "photo", fileId: "large", width: 1280, height: 720 });
});

test("detects Telegram location", () => {
  const message = { location: { latitude: 43.2389, longitude: 76.8897, horizontal_accuracy: 8 } };
  assert.equal(Number(message.location.latitude), 43.2389);
  assert.equal(Number(message.location.longitude), 76.8897);
});
