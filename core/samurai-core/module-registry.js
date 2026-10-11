"use strict";

class ModuleRegistry {
  constructor() {
    this.modules = new Map();
  }

  register(module) {
    if (!module || typeof module.name !== "string" || !module.name.trim()) {
      throw new TypeError("module.name is required");
    }
    if (this.modules.has(module.name)) {
      throw new Error("MODULE_ALREADY_REGISTERED:" + module.name);
    }
    this.modules.set(module.name, module);
    return module;
  }

  get(name) {
    return this.modules.get(name) || null;
  }

  list() {
    return [...this.modules.values()].map((module) => module.name);
  }

  async startAll(core) {
    for (const module of this.modules.values()) {
      if (typeof module.start === "function") await module.start(core);
    }
  }

  async stopAll(core) {
    for (const module of [...this.modules.values()].reverse()) {
      if (typeof module.stop === "function") await module.stop(core);
    }
  }

  health(core) {
    return [...this.modules.values()].map((module) => {
      try {
        const health = typeof module.health === "function" ? module.health(core) : { ok: true };
        return { name: module.name, ...(health || {}) };
      } catch (error) {
        return { name: module.name, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
}

module.exports = { ModuleRegistry };
