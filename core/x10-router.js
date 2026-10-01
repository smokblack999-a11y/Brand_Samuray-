"use strict";

const express = require("express");

const router = express.Router();
const X10_URL = String(process.env.X10_URL || "http://x10:8890").replace(/\/$/, "");
const TIMEOUT_MS = Math.max(2000, Number(process.env.X10_PROXY_TIMEOUT_MS || 15000));

async function call(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(X10_URL + path, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { ok: false, error: "invalid_x10_response" }; }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

router.get("/control", async (_req, res) => {
  try {
    const r = await call("/v1/control");
    return res.status(r.status).json(r.body);
  } catch (error) {
    return res.status(503).json({ ok:false, error:"x10_unavailable" });
  }
});

router.post("/kill", async (req, res) => {
  try {
    const r = await call("/v1/kill", { method:"POST", body:JSON.stringify(req.body || {}) });
    return res.status(r.status).json(r.body);
  } catch {
    return res.status(503).json({ ok:false, error:"x10_unavailable" });
  }
});

router.post("/resume", async (req, res) => {
  try {
    const r = await call("/v1/resume", { method:"POST", body:JSON.stringify(req.body || {}) });
    return res.status(r.status).json(r.body);
  } catch {
    return res.status(503).json({ ok:false, error:"x10_unavailable" });
  }
});

router.post("/incidents", async (req, res) => {
  try {
    const r = await call("/v1/incidents", { method:"POST", body:JSON.stringify(req.body || {}) });
    return res.status(r.status).json(r.body);
  } catch {
    return res.status(503).json({ ok:false, error:"x10_unavailable" });
  }
});

router.get("/incidents/:id", async (req, res) => {
  try {
    const r = await call("/v1/incidents/" + encodeURIComponent(req.params.id));
    return res.status(r.status).json(r.body);
  } catch {
    return res.status(503).json({ ok:false, error:"x10_unavailable" });
  }
});

router.post("/incidents/:id/run", async (req, res) => {
  try {
    const r = await call("/v1/incidents/" + encodeURIComponent(req.params.id) + "/run", { method:"POST" });
    return res.status(r.status).json(r.body);
  } catch {
    return res.status(503).json({ ok:false, error:"x10_unavailable" });
  }
});

module.exports = router;
