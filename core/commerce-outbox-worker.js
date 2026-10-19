"use strict";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeError(error) {
  const raw = String(error?.message || error || "Delivery failed");
  return raw
    .replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/gi, "bot[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:token|api[_-]?key|secret)\s*[:=]\s*["']?)[^,\s"']+/gi, "$1[REDACTED]")
    .slice(0, 300);
}

/**
 * Sequential, single-process outbox runner.
 * Delivery is at-least-once: a crash after the remote side accepts a message
 * but before markOutboxDelivered persists can cause a duplicate on retry.
 * Consumers should deduplicate using idempotencyKey when their transport allows it.
 */
function createOutboxWorker({ commerce, deliver, maxBatch = 25, maxAttempts = 8, logger = () => {} }) {
  if (!commerce || typeof commerce.listOutbox !== "function" ||
      typeof commerce.getOrder !== "function" ||
      typeof commerce.markOutboxDelivered !== "function" ||
      typeof commerce.markOutboxFailed !== "function") {
    throw fail("INVALID_COMMERCE_SERVICE", "A commerce service with outbox methods is required");
  }
  if (typeof deliver !== "function") throw fail("INVALID_DELIVER", "deliver callback is required");
  if (!Number.isSafeInteger(maxBatch) || maxBatch < 1 || maxBatch > 500) {
    throw fail("INVALID_MAX_BATCH", "maxBatch must be an integer from 1 to 500");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw fail("INVALID_MAX_ATTEMPTS", "maxAttempts must be an integer from 1 to 100");
  }
  let running = false;

  async function runOnce() {
    if (running) throw fail("WORKER_ALREADY_RUNNING", "This worker instance is already processing a batch");
    running = true;
    const summary = { scanned: 0, delivered: 0, failed: 0, deadLettered: 0, results: [] };
    try {
      const events = commerce.listOutbox({ limit: maxBatch });
      summary.scanned = events.length;
      for (const event of events) {
        try {
          const order = commerce.getOrder(event.orderId);
          if (!order) throw fail("OUTBOX_ORDER_MISSING", "Outbox event references a missing order");
          await deliver({ event, order, idempotencyKey: event.eventId });
          commerce.markOutboxDelivered({ eventId: event.eventId });
          summary.delivered += 1;
          summary.results.push({ eventId: event.eventId, status: "delivered" });
          logger({ type: "commerce_outbox_delivered", eventId: event.eventId, eventType: event.type });
        } catch (error) {
          const reason = safeError(error);
          const failedEvent = commerce.markOutboxFailed({
            eventId: event.eventId,
            error: reason,
            maxAttempts
          });
          summary.failed += 1;
          if (failedEvent.status === "dead_letter") summary.deadLettered += 1;
          summary.results.push({
            eventId: event.eventId,
            status: failedEvent.status,
            error: reason
          });
          logger({
            type: failedEvent.status === "dead_letter" ? "commerce_outbox_dead_letter" : "commerce_outbox_failed",
            eventId: event.eventId,
            eventType: event.type,
            attempts: failedEvent.attempts
          });
        }
      }
      return summary;
    } finally {
      running = false;
    }
  }

  return { runOnce };
}

module.exports = { createOutboxWorker };
