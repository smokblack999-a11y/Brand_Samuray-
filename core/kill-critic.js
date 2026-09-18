"use strict";

/**
 * Kill Critic v2
 *
 * Evidence-first decision gate for autonomous recovery.
 * It never declares a patch safe merely because an LLM proposed it.
 * Decision order:
 *   evidence -> risk -> confidence -> sandbox/CI evidence -> action.
 */

const DEFAULTS = Object.freeze({
  minSandboxConfidence: 0.75,
  minAutoPrConfidence: 0.90,
  maxFiles: 5,
  maxChangedLines: 250,
  maxAttempts: 3,
  maxRisk: "medium"
});

const RISK_WEIGHT = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

function clamp(n) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function normalizeRisk(value) {
  const risk = String(value || "high").toLowerCase();
  return Object.prototype.hasOwnProperty.call(RISK_WEIGHT, risk) ? risk : "high";
}

function scoreEvidence(evidence = {}) {
  const weights = {
    exactErrorMatch: 0.30,
    stackTraceMatch: 0.20,
    changedFileMatch: 0.15,
    dependencyMatch: 0.15,
    historicalMatch: 0.10,
    reproducible: 0.10
  };

  return Number(Object.entries(weights)
    .reduce((sum, [key, weight]) => sum + clamp(evidence[key]) * weight, 0)
    .toFixed(4));
}

function failureFingerprint(input = {}) {
  const normalized = [
    input.errorType,
    input.exitCode,
    input.failedCommand,
    input.errorMessage,
    ...(Array.isArray(input.stackTrace) ? input.stackTrace : []),
    ...(Array.isArray(input.changedFiles) ? input.changedFiles : [])
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== "")
    .map(value => String(value).trim().toLowerCase())
    .join("|");

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assessPatch(input = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const evidence = input.evidence || {};
  const risk = normalizeRisk(input.risk);
  const files = Array.isArray(input.changedFiles) ? input.changedFiles.filter(Boolean) : [];
  const changedLines = Math.max(0, Number(input.changedLines) || 0);
  const attempts = Math.max(0, Number(input.attempts) || 0);

  const evidenceScore = scoreEvidence(evidence);
  const sandboxPassed = input.sandboxPassed === true;
  const ciPassed = input.ciPassed === true;
  const reproduction = input.reproduction === true;
  const causality = input.causality === true;

  const reasons = [];
  if (!reproduction) reasons.push("REPRODUCTION_REQUIRED");
  if (!causality) reasons.push("CAUSALITY_REQUIRED");
  if (!sandboxPassed) reasons.push("SANDBOX_REQUIRED");
  if (!ciPassed) reasons.push("CI_REQUIRED");
  if (files.length === 0) reasons.push("CHANGED_FILES_REQUIRED");
  if (files.length > cfg.maxFiles) reasons.push("TOO_MANY_FILES");
  if (changedLines > cfg.maxChangedLines) reasons.push("PATCH_TOO_LARGE");
  if (attempts >= cfg.maxAttempts) reasons.push("RETRY_BUDGET_EXHAUSTED");
  if (RISK_WEIGHT[risk] > RISK_WEIGHT[normalizeRisk(cfg.maxRisk)]) reasons.push("RISK_TOO_HIGH");

  let confidence = evidenceScore;
  if (sandboxPassed) confidence += 0.20;
  if (ciPassed) confidence += 0.20;
  if (reproduction) confidence += 0.05;
  if (causality) confidence += 0.05;
  confidence = Number(clamp(confidence).toFixed(4));

  let action = "STOP";
  if (reasons.length === 0 && confidence >= cfg.minAutoPrConfidence) {
    action = "OPEN_PR";
  } else if (
    reasons.filter(reason => !["SANDBOX_REQUIRED", "CI_REQUIRED"].includes(reason)).length === 0 &&
    evidenceScore >= cfg.minSandboxConfidence
  ) {
    action = "SANDBOX";
  } else if (
    reasons.length === 0 ||
    (reproduction && causality && evidenceScore >= cfg.minSandboxConfidence)
  ) {
    action = "HUMAN_REVIEW";
  }

  return {
    version: 2,
    action,
    confidence,
    evidenceScore,
    risk,
    fingerprint: failureFingerprint(input),
    reasons,
    gates: {
      reproduction,
      causality,
      sandboxPassed,
      ciPassed,
      files: files.length,
      changedLines,
      attempts
    }
  };
}

module.exports = {
  DEFAULTS,
  failureFingerprint,
  scoreEvidence,
  assessPatch
};
