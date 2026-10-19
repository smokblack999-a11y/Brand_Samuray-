"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createCiAgentStore(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, "data");
  const filePath = options.filePath || process.env.CI_AGENT_STATE_FILE || path.join(dataDir, "ci-agent-state.json");

  function load() {
    if (!fs.existsSync(filePath)) return { events: [], deliveries: [] };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      const error = new Error("CI-AGENT state file is unreadable or invalid JSON");
      error.code = "CI_AGENT_STATE_CORRUPT";
      throw error;
    }
    if (!parsed || !Array.isArray(parsed.events) || !Array.isArray(parsed.deliveries)) {
      const error = new Error("CI-AGENT state file has an invalid schema");
      error.code = "CI_AGENT_STATE_CORRUPT";
      throw error;
    }
    return {
      events: parsed.events.filter(item => item && typeof item.id === "string").slice(-500),
      deliveries: parsed.deliveries.filter(item => typeof item === "string").slice(-1000)
    };
  }

  function save(snapshot) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = filePath + "." + process.pid + ".tmp";
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      events: Array.isArray(snapshot?.events) ? snapshot.events.slice(-500) : [],
      deliveries: Array.isArray(snapshot?.deliveries) ? snapshot.deliveries.slice(-1000) : []
    }) + "\n";
    let fd;
    try {
      fd = fs.openSync(temporaryPath, "w", 0o600);
      fs.writeFileSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {}
      }
      try { fs.rmSync(temporaryPath, { force: true }); } catch {}
      error.code = error.code || "CI_AGENT_STATE_WRITE_FAILED";
      throw error;
    }
  }

  return { load, save, filePath };
}

module.exports = { createCiAgentStore };
