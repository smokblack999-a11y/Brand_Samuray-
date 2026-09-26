const test = require("node:test");
const assert = require("node:assert/strict");
const { mediaFromMessage } = require("../media-ingest");

test("detects the highest-resolution Telegram photo", () => {
  const media = mediaFromMessage({
    photo: [
      { file_id: "small", width: 90, height: 90 },
      { file_id: "large", width: 1280, height: 720 }
    ]
  });
  assert.deepEqual(media, { type: "photo", fileId: "large", width: 1280, height: 720 });
});

test("detects Telegram video and location shape", () => {
  const media = mediaFromMessage({
    video: { file_id: "video-1", width: 1920, height: 1080, duration: 4 }
  });
  assert.equal(media.type, "video");
  assert.equal(media.fileId, "video-1");
});
