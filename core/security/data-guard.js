"use strict";

/**
 * Data minimization / governance boundary for X10THINC.
 * It keeps only the metadata needed to reason about a repair.
 */

const MAX_CONTEXT_BYTES = 32 * 1024;

const CLASSIFICATIONS = Object.freeze({
  PUBLIC: "public",
  INTERNAL: "internal",
  CONFIDENTIAL: "confidential",
  SECRET: "secret"
});

function classify(value = {}) {
  const text = JSON.stringify(value);
  if (/(?:password|api[_-]?key|access[_-]?token|private[_-]?key|authorization)\s*["':=]/i.test(text)) {
    return CLASSIFICATIONS.SECRET;
  }
  if (/(?:email|phone|address|fullName|dateOfBirth|employee|customer)/i.test(text)) {
    return CLASSIFICATIONS.CONFIDENTIAL;
  }
  return CLASSIFICATIONS.INTERNAL;
}

function minimizeRepairContext(input = {}) {
  const files = Array.isArray(input.files) ? input.files.slice(0, 200) : [];
  const result = {
    jobId: String(input.jobId || ""),
    repository: String(input.repository || ""),
    commitSha: String(input.commitSha || ""),
    files,
    failureClass: String(input.failureClass || "unknown"),
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice(0, 20) : [],
    policyVersion: "data-guard-v1"
  };

  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CONTEXT_BYTES) {
    result.files = result.files.slice(0, 25);
    result.truncated = true;
  }
  return result;
}

function retentionRecord({ classification = CLASSIFICATIONS.INTERNAL, purpose = "repair-evidence", ttlDays = 30 } = {}) {
  const safeTtl = Math.max(1, Math.min(3650, Number(ttlDays) || 30));
  return {
    classification,
    purpose,
    ttlDays: safeTtl,
    deleteAfter: new Date(Date.now() + safeTtl * 86400000).toISOString()
  };
}

module.exports = {
  CLASSIFICATIONS,
  MAX_CONTEXT_BYTES,
  classify,
  minimizeRepairContext,
  retentionRecord
};
