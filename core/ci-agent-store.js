"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function createCiAgentStore(filePath) {
  if (!filePath || typeof filePath !== "string") throw new TypeError("CI_AGENT_STATE_FILE must be a non-empty path");
  const target = path.resolve(filePath);

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      if (parsed?.version !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.deliveries)) {
        const error = new Error("CI-AGENT state file has an unsupported format");
        error.code = "CI_AGENT_STATE_INVALID";
        throw error;
      }
      return {
        events: parsed.events.filter(item => item && typeof item.id === "string").slice(-500),
        deliveries: parsed.deliveries.filter(item => typeof item === "string").slice(-1000)
      };
    } catch (error) {
      if (error.code === "ENOENT") return { events: [], deliveries: [] };
      throw error;
    }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      events: state.events.slice(-500),
      deliveries: state.deliveries.slice(-1000)
    });
    try {
      fs.writeFileSync(temp, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temp, target);
      try { fs.chmodSync(target, 0o600); } catch (_error) { /* best-effort on supported filesystems */ }
    } finally {
      try { fs.unlinkSync(temp); } catch (_error) { /* already renamed or absent */ }
    }
  }

  return { load, save, path: target };
}

module.exports = { createCiAgentStore };
