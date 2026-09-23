"use strict";

const crypto = require("node:crypto");
const { ACTIONS, decide: killCriticDecide, normalizeEvidence } = require("./kill-critic");

const PROTECTED = Object.freeze([
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(auth|crypto|tls|acl|policy)(\/|$)/i,
  /(^|\/)Dockerfile(?:\.|$)/i,
  /(^|\/)docker-compose(?:\.|$)/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i,
  /(^|\/)android\/app\/src\/main\/AndroidManifest\.xml$/i
]);

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function clamp(n) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
}

function list(value) {
  return Array.isArray(value) ? [...new Set(value.filter(Boolean).map(String))] : [];
}

function protectedPaths(files) {
  return list(files).filter(file => PROTECTED.some(re => re.test(file)));
}

function intersect(a, b) {
  const set = new Set(list(b));
  return list(a).filter(x => set.has(x));
}

function contradictionCheck(evidence) {
  const e = normalizeEvidence(evidence);
  const contradictions = [];
  if (e.regressionPass && !e.sandboxPass) contradictions.push("REGRESSION_WITHOUT_SANDBOX");
  if (e.sandboxPass && !e.scopeMatch) contradictions.push("SANDBOX_WITHOUT_SCOPE");
  if (e.exactErrorMatch === 0 && e.stackTraceMatch === 0 && e.dependencyMatch === 0) {
    contradictions.push("NO_ROOT_CAUSE_SIGNAL");
  }
  return contradictions;
}

function solveRecovery(input = {}) {
  const diagnosis = input.diagnosis || {};
  const evidence = normalizeEvidence(diagnosis.evidence || input.evidence || {});
  const patch = input.patch || {};
  const files = list(patch.files || diagnosis.affectedFiles);
  const affected = list(diagnosis.affectedFiles);
  const protectedTouched = protectedPaths(files);
  const causalFiles = intersect(files, affected);
  const contradictions = contradictionCheck(evidence);

  const changedFiles = Math.max(0, Number(patch.changedFiles || files.length));
  const changedLines = Math.max(0, Number(patch.changedLines || 0));
  const deletions = Math.max(0, Number(patch.deletions || 0));

  const causality = affected.length === 0
    ? 0.35
    : clamp(causalFiles.length / Math.max(1, Math.min(affected.length, files.length || 1)));

  const minimality =
    changedFiles === 0 ? 0 :
    clamp(1 - Math.max(0, changedFiles - 1) * 0.08 - Math.max(0, changedLines - 40) / 1000 - Math.max(0, deletions - 10) / 500);

  const independence = clamp(
    (evidence.exactErrorMatch > 0 ? 0.25 : 0) +
    (evidence.stackTraceMatch > 0 ? 0.15 : 0) +
    (evidence.dependencyMatch > 0 ? 0.15 : 0) +
    (evidence.changedFileMatch > 0 ? 0.15 : 0) +
    (evidence.scopeMatch > 0 ? 0.10 : 0) +
    (evidence.sandboxPass ? 0.10 : 0) +
    (evidence.regressionPass ? 0.10 : 0)
  );

  const reasoningScore = Number(clamp(
    independence * 0.45 +
    causality * 0.25 +
    minimality * 0.15 +
    (evidence.historicalMatch * 0.10) +
    (evidence.scopeMatch * 0.05)
  ).toFixed(4));

  const base = killCriticDecide(
    { attempts: input.attempts, evidence, patch: { ...patch, sensitivePaths: protectedTouched } },
    input.options
  );

  const hardStops = [];
  if (contradictions.length) hardStops.push("CONTRADICTORY_EVIDENCE");
  if (protectedTouched.length) hardStops.push("PROTECTED_PATH");
  if (causalFiles.length === 0 && affected.length > 0) hardStops.push("PATCH_OUTSIDE_DIAGNOSED_SCOPE");

  let action = base.action;
  const reasons = [...(base.reasons || [])];

  if (diffCritic && !diffCritic.safe) hardStops.push("SEMANTIC_DIFF_RISK");\n\n  if (hardStops.length) {
    action = protectedTouched.length ? ACTIONS.HUMAN_REVIEW : ACTIONS.STOP;
    reasons.push(...hardStops);
  }

  if (action === ACTIONS.CREATE_PR && reasoningScore < 0.85) {
    action = ACTIONS.HUMAN_REVIEW;
    reasons.push("X10THINC_REASONING_THRESHOLD");
  }

  const verdict = {
    engine: "X10THINC",
    version: 1,
    action,
    score: base.score,
    reasoningScore,
    risk: base.risk,
    confidence: Number(clamp((base.score * 0.55) + (reasoningScore * 0.45)).toFixed(4)),
    evidence,
    causality: {
      affectedFiles: affected,
      patchFiles: files,
      overlap: causalFiles,
      score: Number(causality.toFixed(4))
    },
    minimality: Number(minimality.toFixed(4)),
    contradictions,
    protectedPaths: protectedTouched,
    reasons: [...new Set(reasons)],
    stateHash: stableHash({
      diagnosis: {
        fingerprint: diagnosis.fingerprint || null,
        errorType: diagnosis.errorType || null,
        affectedFiles: affected
      },
      patch: { files, changedFiles, changedLines, deletions },
      evidence,
      action,
      reasoningScore
    })
  };

  return verdict;
}

module.exports = {
  PROTECTED,
  stableHash,
  protectedPaths,
  contradictionCheck,
  solveRecovery
};
