"use strict";

function createRepairCandidateProvider({ generate } = {}) {
  if (typeof generate !== "function") throw new TypeError("generate is required");

  return async function candidateProvider({ mission, plan }) {
    const candidate = await generate({ mission, plan });
    if (!candidate || typeof candidate !== "object") return null;

    const files = Array.isArray(candidate.changed_files) ? candidate.changed_files : [];
    const lines = Number.isInteger(candidate.changed_lines) ? candidate.changed_lines : 0;
    if (files.length === 0 || lines < 0) return null;

    return {
      ...candidate,
      changed_files: files,
      changed_lines: lines
    };
  };
}

module.exports = { createRepairCandidateProvider };
