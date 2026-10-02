"use strict";

const TIMEOUT_MS = Math.max(1000, Number(process.env.HAMYLION_TIMEOUT_MS || 5000));

async function emitHamylionEvent(type, payload, idempotencyKey) {
  const baseUrl = String(process.env.HAMYLION_URL || "").trim();
  const apiKey = String(process.env.HAMYLION_API_KEY || "").trim();
  if (!baseUrl || !apiKey) return { enabled: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl.replace(/\/$/, "") + "/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ type, payload, idempotency_key: idempotencyKey || undefined }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("HAMYLION HTTP " + response.status);
    return { enabled: true, ...(await response.json()) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { emitHamylionEvent };
