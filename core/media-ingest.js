"use strict";

const fs = require("fs");
const path = require("path");

const TELEGRAM_TIMEOUT_MS = Math.max(1000, Number(process.env.TELEGRAM_TIMEOUT_MS || 10000));
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "media");

function api() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

async function telegram(method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${api()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
    return data.result;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Telegram ${method} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mediaFromMessage(message) {
  if (Array.isArray(message?.photo) && message.photo.length) {
    const item = message.photo[message.photo.length - 1];
    return { type: "photo", fileId: item.file_id, width: item.width, height: item.height };
  }
  if (message?.video?.file_id) return {
    type: "video", fileId: message.video.file_id,
    width: message.video.width, height: message.video.height,
    duration: message.video.duration
  };
  if (message?.document?.file_id) return {
    type: "document", fileId: message.document.file_id,
    fileName: message.document.file_name || null,
    mimeType: message.document.mime_type || null
  };
  return null;
}

async function downloadTelegramFile(fileId, originalName = "media.bin") {
  if (!fileId) throw new Error("fileId is required");
  const file = await telegram("getFile", { file_id: fileId });
  if (!file?.file_path) throw new Error("Telegram did not return file_path");

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const safeName = path.basename(originalName || path.basename(file.file_path));
  const ext = path.extname(file.file_path) || path.extname(safeName);
  const output = path.join(MEDIA_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${api().replace("/bot" + process.env.TELEGRAM_BOT_TOKEN, "")}/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(output, buffer);
    return { fileId, filePath: file.file_path, storedPath: output, bytes: buffer.length };
  } finally {
    clearTimeout(timer);
  }
}

async function ingestMessageMedia(message) {
  const media = mediaFromMessage(message);
  const location = message?.location ? {
    latitude: Number(message.location.latitude),
    longitude: Number(message.location.longitude),
    horizontalAccuracy: message.location.horizontal_accuracy ?? null,
    livePeriod: message.location.live_period ?? null
  } : null;
  if (!media && !location) return { media: null, location: null };

  let stored = null;
  if (media?.fileId && String(process.env.DOWNLOAD_TELEGRAM_MEDIA || "true").toLowerCase() === "true") {
    stored = await downloadTelegramFile(media.fileId, media.fileName);
  }
  return { media: media ? { ...media, stored } : null, location };
}

module.exports = { mediaFromMessage, ingestMessageMedia, downloadTelegramFile };
