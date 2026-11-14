"use strict";

const express = require("express");
const { createRateLimiter } = require("../rate-limit");
const { createVisionService } = require("./vision-service");

function createVisionRouter({
  enabled = String(process.env.VISION_ENABLED || "false").toLowerCase() === "true",
  maxBytes = Math.max(1024, Number(process.env.VISION_MAX_IMAGE_BYTES || 8 * 1024 * 1024)),
  service = createVisionService(),
  rateLimiter = createRateLimiter({
    windowMs: Math.max(1000, Number(process.env.VISION_RATE_LIMIT_WINDOW_MS || 60000)),
    max: Math.max(1, Number(process.env.VISION_RATE_LIMIT_MAX || 5))
  })
} = {}) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({
    ok: true,
    enabled,
    provider: "openai-responses",
    configured: Boolean(process.env.OPENAI_API_KEY && (process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL))
  }));

  router.post("/analyze", (req, res, next) => {
    if (!enabled) return res.status(503).json({ ok: false, error: { code: "VISION_DISABLED", message: "Vision is disabled by configuration" }, requestId: req.requestId || null });
    return next();
  }, rateLimiter, (req, res, next) => {
    if (req.get("X-Vision-Consent") !== "true") {
      return res.status(400).json({ ok: false, error: { code: "VISION_CONSENT_REQUIRED", message: "Explicit image-analysis consent is required" }, requestId: req.requestId || null });
    }
    return next();
  }, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: maxBytes }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({ ok: false, error: { code: "UNSUPPORTED_IMAGE_TYPE", message: "Send a raw JPEG, PNG or WEBP image" }, requestId: req.requestId || null });
    }
    try {
      const result = await service.analyze({
        buffer: req.body,
        contentType: req.get("content-type"),
        prompt: req.get("X-Vision-Prompt") || ""
      });
      return res.json({ ok: true, ...result, requestId: req.requestId || null });
    } catch (error) {
      const status = error.code === "IMAGE_TOO_LARGE" ? 413
        : ["UNSUPPORTED_IMAGE_TYPE", "IMAGE_SIGNATURE_MISMATCH"].includes(error.code) ? 415
        : ["EMPTY_IMAGE", "PROMPT_TOO_LONG"].includes(error.code) ? 400
        : 503;
      const message = status === 503 ? "Vision analysis is unavailable" : error.message;
      return res.status(status).json({ ok: false, error: { code: error.code || "VISION_FAILED", message }, requestId: req.requestId || null });
    }
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.too.large") {
      return res.status(413).json({ ok: false, error: { code: "IMAGE_TOO_LARGE", message: "Image exceeds the configured size limit" }, requestId: req.requestId || null });
    }
    return res.status(400).json({ ok: false, error: { code: "INVALID_VISION_REQUEST", message: "Invalid image request" }, requestId: req.requestId || null });
  });

  return router;
}

module.exports = { createVisionRouter };
