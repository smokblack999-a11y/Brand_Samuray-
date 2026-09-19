"use strict";

function createHttpRepairCandidateProvider({ url, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (!url || typeof fetchImpl !== "function") throw new TypeError("url and fetchImpl are required");
  return async function candidateProvider({ mission, plan }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mission, plan }),
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object") return null;
      const files = Array.isArray(body.files) ? body.files : [];
      const changedFiles = Array.isArray(body.changed_files) ? body.changed_files : files.map(file => file.path);
      const changedLines = Number.isInteger(body.changed_lines) ? body.changed_lines : 0;
      if (!files.length || !changedFiles.length || changedLines < 0) return null;
      return { ...body, files, changed_files: changedFiles, changed_lines: changedLines };
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createHttpRepairCandidateProvider };
