"use strict";

const SAFE_CATEGORIES = new Set(["dependency_error", "test_failure", "syntax_error"]);
const FORBIDDEN_PATHS = [
  /^\.github\/workflows\//i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)secrets?\//i,
  /(^|\/)credentials?\//i,
  /(^|\/)\.git\//i
];

function normalizePaths(paths = []) {
  return [...new Set(paths.map(String).map((p) => p.trim()).filter(Boolean))].sort();
}

function createPatchProposal({ diagnosis, changedPaths = [], summary = "" } = {}) {
  if (!diagnosis) throw new Error("diagnosis is required");
  const paths = normalizePaths(changedPaths);
  const forbiddenPaths = paths.filter((p) => FORBIDDEN_PATHS.some((r) => r.test(p)));
  const category = String(diagnosis.category || "generic");
  const bounded = SAFE_CATEGORIES.has(category) &&
    Number(diagnosis.confidence || 0) >= 0.90 &&
    forbiddenPaths.length === 0;

  return {
    status: bounded ? "PATCH_CANDIDATE" : "HUMAN_REVIEW",
    category,
    confidence: Number(diagnosis.confidence || 0),
    fingerprint: diagnosis.fingerprint || null,
    scope: { paths, forbiddenPaths, maxFiles: 3 },
    intent: bounded
      ? "Generate the smallest testable patch for " + category + ". Preserve public APIs and unrelated behavior."
      : "Do not generate an autonomous patch; require human review.",
    summary: String(summary || diagnosis.summary || ""),
    constraints: [
      "No secrets or credentials",
      "No workflow/security policy changes",
      "No deployment or merge",
      "Minimal diff",
      "Tests must accompany behavior changes"
    ]
  };
}

module.exports = { createPatchProposal, normalizePaths, FORBIDDEN_PATHS };
