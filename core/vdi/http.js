"use strict";

const { verifyPayloadSignature, validateEvent, evaluateEvent } = require("./index");

/**
 * Express-compatible VDI ingestion handler.
 * Caller must capture exact request bytes as req.rawBody before JSON parsing.
 * This handler never performs a physical action.
 */
function createVdiHandler(options = {}) {
  const enabled = options.enabled === true;
  const secret = options.secret;
  const ledger = options.ledger;
  const sessionMatcher = options.sessionMatcher;
  const clock = typeof options.now === "function" ? options.now : Date.now;

  return async function vdiIngestHandler(req, res) {
    const send = (status, body) => res.status(status).json({
      ...body, mode: "SHADOW_ONLY", physical_action_performed: false
    });

    if (!enabled) return send(404, { ok: false, error: "VDI_SHADOW_DISABLED" });
    if (typeof secret !== "string" || secret.length < 32 || !ledger || typeof ledger.append !== "function") {
      return send(503, { ok: false, error: "VDI_SHADOW_NOT_CONFIGURED" });
    }

    const rawBody = req.rawBody;
    const signature = req.get ? req.get("X-VDI-Signature") : req.headers?.["x-vdi-signature"];
    if (!Buffer.isBuffer(rawBody)) return send(400, { ok: false, error: "RAW_BODY_REQUIRED" });
    if (!verifyPayloadSignature(rawBody, signature, secret)) return send(401, { ok: false, error: "INVALID_SIGNATURE" });

    let event;
    try { event = JSON.parse(rawBody.toString("utf8")); }
    catch { return send(400, { ok: false, error: "INVALID_JSON" }); }

    const nowMs = clock();
    const validation = validateEvent(event, { nowMs });
    if (!validation.valid) return send(422, { ok: false, error: "INVALID_EVENT", validation });

    let matchedSession = false;
    if (typeof sessionMatcher === "function") {
      try { matchedSession = (await sessionMatcher(event)) === true; }
      catch { matchedSession = false; }
    }

    const decision = evaluateEvent(event, {
      nowMs, sourceAuthenticated: true, matchedSession
    });

    try {
      const receipt = ledger.append(decision);
      return send(200, {
        ok: true, decision, receipt: receipt.receipt,
        duplicate_receipt: receipt.duplicate === true
      });
    } catch {
      return send(503, { ok: false, error: "PROOF_LEDGER_UNAVAILABLE" });
    }
  };
}

module.exports = { createVdiHandler };
