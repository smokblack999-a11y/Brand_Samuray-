"use strict";

const crypto = require("crypto");
const { routeWorkflowRun } = require("./autonomy/event-proof-router");

function verifySignature(rawBody, signature, secret) {
  if (!secret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createWorkflowRunIngress({ queue, secret } = {}) {
  if (!queue || typeof queue.enqueue !== "function") throw new TypeError("queue is required");
  if (!secret) throw new TypeError("secret is required");

  return Object.freeze({
    accept({ rawBody, signature, eventName, payload }) {
      if (!verifySignature(rawBody, signature, secret)) {
        return Object.freeze({ accepted: false, reason: "invalid_signature" });
      }
      if (eventName !== "workflow_run") {
        return Object.freeze({ accepted: false, reason: "ignored_event" });
      }

      const routed = routeWorkflowRun(payload);
      if (routed.action !== "enqueue_repair") {
        return Object.freeze({ accepted: true, routed, queued: false });
      }

      const queued = queue.enqueue({
        ...routed.job,
        event: "workflow_run",
        jobKey: routed.jobKey
      });
      return Object.freeze({ accepted: true, routed, queued });
    }
  });
}

module.exports = { verifySignature, createWorkflowRunIngress };
