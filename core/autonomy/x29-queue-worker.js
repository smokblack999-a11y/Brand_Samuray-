"use strict";

/**
 * X29 queue worker.
 *
 * The handler is injected so execution remains bounded and testable.
 * A restart-safe queue item is claimed before processing and persisted after
 * success/failure. No autonomous merge/deploy behavior is hidden here.
 */

function createX29QueueWorker({ queue, handler, maxAttempts = 2 } = {}) {
  if (!queue || typeof queue.claimNext !== "function") throw new TypeError("queue is required");
  if (typeof handler !== "function") throw new TypeError("handler is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new RangeError("maxAttempts must be 1..10");

  return Object.freeze({
    async processOnce() {
      const item = queue.claimNext();
      if (!item) return { status: "idle" };

      const attempts = Number(item.workerAttempts || 0) + 1;
      try {
        const result = await handler(item);
        return queue.complete(item.id, { attempts, value: result });
      } catch (error) {
        return queue.fail(item.id, error, { retry: attempts < maxAttempts });
      }
    }
  });
}

module.exports = { createX29QueueWorker };
