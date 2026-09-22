"use strict";

const { validateUnifiedDiff, MAX_PATCH_BYTES } = require("./patch-candidate");
const { evaluateRepair } = require("../security/security-gate");

const MAX_PROPOSAL_BYTES = MAX_PATCH_BYTES;

function buildPatchProposal(input = {}) {
  if (input.evidenceOnly !== true) return { accepted: false, reason: "DIAGNOSIS_NOT_EVIDENCE_ONLY" };
  if (input.reproduction !== true || input.causality !== true) {
    return { accepted: false, reason: "REPRODUCTION_AND_CAUSALITY_REQUIRED" };
  }

  const diff = String(input.diff || "");
  if (!diff) return { accepted: false, reason: "PATCH_DIFF_REQUIRED" };
  if (Buffer.byteLength(diff, "utf8") > MAX_PROPOSAL_BYTES) {
    return { accepted: false, reason: "PATCH_TOO_LARGE" };
  }

  let validated;
  try {
    validated = validateUnifiedDiff(diff);
  } catch (error) {
    return { accepted: false, reason: String(error?.message || error) };
  }

  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles.filter(Boolean) : [];
  if (changedFiles.length && validated.files.some(file => !changedFiles.includes(file))) {
    return { accepted: false, reason: "PATCH_TOUCHES_UNRELATED_FILE" };
  }

  const security = evaluateRepair({
    diff,
    jobId: input.jobId,
    repository: input.repository,
    commitSha: input.commitSha,
    failureClass: input.failureClass,
    evidenceRefs: input.evidenceRefs,
    ttlDays: input.ttlDays
  });

  if (security.gate !== "PASS") {
    return {
      accepted: false,
      reason: security.gate === "BLOCK" ? "SECURITY_GATE_BLOCKED" : "SECURITY_REVIEW_REQUIRED",
      security
    };
  }

  return {
    accepted: true,
    source: String(input.source || "external-proposal"),
    security,
    proposal: {
      version: 2,
      diff: validated.diff,
      files: validated.files,
      evidenceOnly: true,
      reproduction: true,
      causality: true,
      requiresSandbox: true,
      autonomousWrite: false,
      autonomousMerge: false
    }
  };
}

module.exports = { buildPatchProposal };
