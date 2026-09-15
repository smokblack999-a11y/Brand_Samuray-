"use strict";

const MAX_FILES = 3;
const MAX_PATCH_BYTES = 20000;

const SAFE_FIXES = [
  {
    id: "npm-install-lockfile",
    categories: ["dependency_error"],
    evidence: /npm (?:err!|error)|could not resolve|dependency resolution|package-lock/i,
    description: "Reproduce dependency resolution and refresh the lockfile only when the repository policy permits it."
  },
  {
    id: "syntax-targeted",
    categories: ["syntax_error"],
    evidence: /syntaxerror|syntax error|parse error|unexpected token/i,
    description: "Identify the exact failing source file and produce a minimal syntax-only candidate; do not rewrite unrelated files."
  },
  {
    id: "test-targeted",
    categories: ["test_failure"],
    evidence: /assertionerror|test failed|tests? failed|jest.*failed|vitest.*failed/i,
    description: "Target the failing test and its directly implicated source; candidate remains unverified until the same test passes in isolation."
  }
];

function buildPatchCandidate(diagnosis, changedFiles = []) {
  if (!diagnosis || diagnosis.evidenceOnly !== true) {
    return { accepted: false, reason: "DIAGNOSIS_NOT_EVIDENCE_ONLY" };
  }
  if (diagnosis.reproduction !== true || diagnosis.causality !== true) {
    return { accepted: false, reason: "REPRODUCTION_AND_CAUSALITY_REQUIRED" };
  }
  const category = diagnosis.category || "generic";
  const rule = SAFE_FIXES.find(item => item.categories.includes(category));
  if (!rule) return { accepted: false, reason: "NO_BOUNDED_FIX_STRATEGY", category };

  const files = Array.from(new Set((Array.isArray(changedFiles) ? changedFiles : []).filter(Boolean))).slice(0, MAX_FILES);
  const candidate = {
    strategyId: rule.id,
    category,
    description: rule.description,
    files,
    patch: null,
    patchBytes: 0,
    autonomousWrite: false,
    requiresSandbox: true,
    requiresCritic: true
  };
  const serialized = JSON.stringify(candidate);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PATCH_BYTES) {
    return { accepted: false, reason: "PATCH_CANDIDATE_TOO_LARGE" };
  }
  return { accepted: true, candidate };
}

module.exports = { buildPatchCandidate, SAFE_FIXES, MAX_FILES, MAX_PATCH_BYTES };
