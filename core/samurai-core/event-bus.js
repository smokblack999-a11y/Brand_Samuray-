"use strict";

class SamuraiEventBus {
  constructor() {
    this.handlers = new Map();
    this.sequence = 0;
  }

  on(eventName, handler) {
    if (!eventName || typeof handler !== "function") {
      throw new TypeError("eventName and handler are required");
    }
    const list = this.handlers.get(eventName) || [];
    list.push(handler);
    this.handlers.set(eventName, list);
    return () => {
      const current = this.handlers.get(eventName) || [];
      const next = current.filter((item) => item !== handler);
      if (next.length) this.handlers.set(eventName, next);
      else this.handlers.delete(eventName);
    };
  }

  async publish(eventName, payload = {}) {
    const event = {
      id: ++this.sequence,
      name: String(eventName),
      at: new Date().toISOString(),
      payload
    };
    const results = [];
    for (const handler of [...(this.handlers.get(event.name) || [])]) {
      try {
        await handler(event);
        results.push({ ok: true });
      } catch (error) {
        results.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      event,
      handlers: results.length,
      failures: results.filter((item) => !item.ok).length
    };
  }

  listenerCount(eventName) {
    return (this.handlers.get(eventName) || []).length;
  }
}

module.exports = { SamuraiEventBus };
