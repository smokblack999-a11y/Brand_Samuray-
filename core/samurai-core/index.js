"use strict";

const crypto = require("crypto");
const { SamuraiEventBus } = require("./event-bus");
const { ModuleRegistry } = require("./module-registry");

class SamuraiCore {
  constructor(options = {}) {
    this.version = options.version || "0.1.0";
    this.instanceId = options.instanceId || crypto.randomUUID();
    this.startedAt = null;
    this.state = "CREATED";
    this.events = new SamuraiEventBus();
    this.modules = new ModuleRegistry();
    this.memory = new Map();
    this.audit = [];
  }

  remember(key, value) {
    this.memory.set(String(key), value);
    return value;
  }

  recall(key) {
    return this.memory.get(String(key));
  }

  recordAudit(type, data = {}) {
    const entry = {
      id: this.audit.length + 1,
      type: String(type),
      at: new Date().toISOString(),
      data
    };
    this.audit.push(entry);
    return entry;
  }

  async emit(name, payload = {}) {
    const result = await this.events.publish(name, payload);
    this.recordAudit("event", {
      eventId: result.event.id,
      name: result.event.name,
      handlers: result.handlers,
      failures: result.failures
    });
    return result;
  }

  async start() {
    if (this.state === "RUNNING") return this.health();
    if (this.state === "STOPPING") throw new Error("CORE_STOPPING");

    this.state = "STARTING";
    this.startedAt = new Date().toISOString();

    try {
      await this.modules.startAll(this);
      this.state = "RUNNING";
      await this.emit("core.started", { instanceId: this.instanceId, version: this.version });
      return this.health();
    } catch (error) {
      this.state = "FAILED";
      this.recordAudit("core.start.failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async stop() {
    if (this.state === "STOPPED" || this.state === "CREATED") {
      this.state = "STOPPED";
      return this.health();
    }

    this.state = "STOPPING";
    await this.modules.stopAll(this);
    this.state = "STOPPED";
    await this.emit("core.stopped", { instanceId: this.instanceId });
    return this.health();
  }

  health() {
    return {
      ok: this.state === "RUNNING",
      service: "SamuraiCore",
      version: this.version,
      instanceId: this.instanceId,
      state: this.state,
      startedAt: this.startedAt,
      modules: this.modules.health(this),
      memoryKeys: this.memory.size,
      auditEntries: this.audit.length
    };
  }
}

module.exports = { SamuraiCore };
