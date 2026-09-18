"use strict";

/**
 * Kill Critic v2
 *
 * Deterministic safety gate for automated CI recovery.
 * It never treats an LLM's confidence as proof. A patch must accumulate
 * independent evidence before it can be promoted to a PR.
 */

const ACTIONS = Object.freeze({
  STOP: "STOP",
  HUMAN_REVIEW: "HUMAN_REVIEW",
  SANDBOX: "SANDBOX",
  CREATE_PR: "CREATE_PR"
});

const DEFAULTS = Object.freeze({
  sandboxPassWeight: 0.25,
  regressionPassWeight: 0.20,
  exactErrorWeight: 0.20,
  stackTraceWeight: 0.10,
  changedFileWeight: 0.10,
  dependencyWeight: 0.05,
  historicalWeight: 0.05,
  scopeWeight: 0.05,
  sandboxThreshold: 0.25,
  prThreshold: 0.90,
  maxChangedFiles: 12,
  maxChangedLines: 600,
  maxAttempts: 3
});

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

function bool(value) {
  return value === true;
}

function normalizeEvidence(input = {}) {
  return {
    exactErrorMatch: clamp(input.exactErrorMatch),
    stackTraceMatch: clamp(input.stackTraceMatch),
    changedFileMatch: clamp(input.changedFileMatch),
    dependencyMatch: clamp(input.dependencyMatch),
    historicalMatch: clamp(input.historicalMatch),
    scopeMatch: clamp(input.scopeMatch),
    sandboxPass: bool(input.sandboxPass),
    regressionPass: bool(input.regressionPass)
  };
}

function fingerprint(failure = {}) {
  const text = [
    failure.workflow,
    failure.job,
    failure.step,
    failure.exitCode,
    failure.errorType,
    failure.errorMessage,
    failure.stackTrace,
    failure.command
  ].filter(v => v !== undefined && v !== null).join("\n").trim();

  // Stable, dependency-free fingerprint. The caller may persist this value.
  const crypto = require("node:crypto");
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function scoreEvidence(evidence, options = {}) {
  const w = { ...DEFAULTS, ...options };
  const e = normalizeEvidence(evidence);

  const score =
    e.exactErrorMatch * w.exactErrorWeight +
    e.stackTraceMatch * w.stackTraceWeight +
    e.changedFileMatch * w.changedFileWeight +
    e.dependencyMatch * w.dependencyWeight +
    e.historicalMatch * w.historicalWeight +
    e.scopeMatch * w.scopeWeight +
    (e.sandboxPass ? w.sandboxPassWeight : 0) +
    (e.regressionPass ? w.regressionPassWeight : 0);

  return Number(clamp(score).toFixed(4));
}

function riskLevel(patch = {}, options = {}) {
  const w = { ...DEFAULTS, ...options };
  const files = Math.max(0, Number(patch.changedFiles || 0));
  const lines = Math.max(0, Number(patch.changedLines || 0));
  const sensitive = Array.isArray(patch.sensitivePaths) && patch.sensitivePaths.length > 0;
  const deletes = Math.max(0, Number(patch.deletions || 0));

  if (sensitive || deletes > 100 || files > w.maxChangedFiles || lines > w.maxChangedLines) return "high";
  if (files > 5 || lines > 250 || patch.crossesPackageBoundary === true) return "medium";
  return "low";
}

function decide(input = {}, options = {}) {
  const w = { ...DEFAULTS, ...options };
  const evidence = normalizeEvidence(input.evidence);
  const risk = riskLevel(input.patch, w);
  const attempts = Math.max(0, Number(input.attempts || 0));
  const score = scoreEvidence(evidence, w);
  const reasons = [];

  if (attempts >= w.maxAttempts) {
    reasons.push("retry_budget_exhausted");
    return { action: ACTIONS.STOP, score, risk, reasons };
  }

  if (risk === "high") {
    reasons.push("high_risk_patch");
    return { action: ACTIONS.HUMAN_REVIEW, score, risk, reasons };
  }

  if (!evidence.exactErrorMatch && !evidence.stackTraceMatch && !evidence.dependencyMatch) {
    reasons.push("insufficient_root_cause_evidence");
    return { action: ACTIONS.STOP, score, risk, reasons };
  }

  if (!evidence.sandboxPass) {
    reasons.push("sandbox_required");
    return {
      action: score >= w.sandboxThreshold ? ACTIONS.SANDBOX : ACTIONS.STOP,
      score,
      risk,
      reasons
    };
  }

  if (!evidence.regressionPass) {
    reasons.push("regression_guard_failed");
    return { action: ACTIONS.HUMAN_REVIEW, score, risk, reasons };
  }

  if (score < w.prThreshold) {
    reasons.push("confidence_below_pr_threshold");
    return { action: ACTIONS.HUMAN_REVIEW, score, risk, reasons };
  }

  reasons.push("independent_evidence_passed");
  return { action: ACTIONS.CREATE_PR, score, risk, reasons };
}

module.exports = {
  ACTIONS,
  DEFAULTS,
  fingerprint,
  normalizeEvidence,
  scoreEvidence,
  riskLevel,
  decide
};
