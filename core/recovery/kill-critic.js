"use strict";

const REQUIRED = ["patchApplied","sandboxPassed","testsPassed","ciPassed"];

function evaluate(input = {}) {
  const failed = REQUIRED.filter(key => input[key] !== true);
  const filesChanged = Array.isArray(input.filesChanged) ? input.filesChanged : [];
  const maxFilesChanged = Number(input.maxFilesChanged || 10);
  const attempts = Number(input.attempts || 0);
  const maxAttempts = Number(input.maxAttempts || 3);

  if (attempts > maxAttempts) return { decision: "frozen", reason: "recovery_budget_exceeded", failed };
  if (filesChanged.length > maxFilesChanged) return { decision: "human_review", reason: "too_many_files_changed", failed };
  if (input.regressionDetected === true) return { decision: "retryable", reason: "regression_detected", failed };
  if (failed.length === 0) return { decision: "recovered", reason: "independent_verification_passed", failed: [] };
  if (input.patchApplied === true && input.sandboxPassed !== true) return { decision: "retryable", reason: "sandbox_failed", failed };
  return { decision: "human_review", reason: "verification_incomplete", failed };
}

module.exports = { REQUIRED, evaluate };
