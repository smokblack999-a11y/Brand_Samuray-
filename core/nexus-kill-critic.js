"use strict";

const crypto = require("node:crypto");
const { FORBIDDEN_PATHS } = require("./nexus-patch-proposal");

const DEFAULT_MAX_FILES = 3;
const DEFAULT_MAX_ADDED_LINES = 120;
const DEFAULT_MAX_DELETED_LINES = 120;

function countDiffLines(diff) {
  const lines = String(diff || "").split("\n");
  let added = 0;
  let deleted = 0;
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
}

function hasSecretLikeMaterial(diff) {
  return /(BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|password\s*[:=]|token\s*[:=]|secret\s*[:=])/i.test(String(diff || ""));
}

function inspectPatch({
  proposal,
  changedPaths = [],
  diffText = "",
  maxFiles = DEFAULT_MAX_FILES,
  maxAddedLines = DEFAULT_MAX_ADDED_LINES,
  maxDeletedLines = DEFAULT_MAX_DELETED_LINES
} = {}) {
  if (!proposal) throw new Error("proposal is required");

  const paths = [...new Set(
    changedPaths.map(String).map((p) => p.trim()).filter(Boolean)
  )].sort();

  const diff = String(diffText || "");
  const forbidden = paths.filter((p) => FORBIDDEN_PATHS.some((r) => r.test(p)));
  const { added, deleted } = countDiffLines(diff);
  const fileLimit = Number(proposal.scope?.maxFiles || maxFiles);

  const checks = {
    proposalBounded: proposal.status === "PATCH_CANDIDATE",
    forbiddenPaths: forbidden.length === 0,
    fileScope: paths.length > 0 && paths.length <= Math.min(fileLimit, maxFiles),
    diffPresent: diff.trim().length > 0,
    addedLineScope: added <= maxAddedLines,
    deletedLineScope: deleted <= maxDeletedLines,
    secretFree: !hasSecretLikeMaterial(diff),
    workflowUnchanged: !paths.some((p) => /^\.github\/workflows\//i.test(p)),
    gitMetadataUnchanged: !paths.some((p) => /(^|\/)\.git\//i.test(p))
  };

  const failures = [];
  if (!checks.proposalBounded) failures.push("proposal_not_bounded");
  if (!checks.forbiddenPaths) failures.push("forbidden_paths");
  if (!checks.fileScope) failures.push("scope_too_large_or_empty");
  if (!checks.diffPresent) failures.push("missing_diff");
  if (!checks.addedLineScope) failures.push("too_many_added_lines");
  if (!checks.deletedLineScope) failures.push("too_many_deleted_lines");
  if (!checks.secretFree) failures.push("secret_like_material");
  if (!checks.workflowUnchanged) failures.push("workflow_mutation");
  if (!checks.gitMetadataUnchanged) failures.push("git_metadata_mutation");

  const evidence = {
    changedPaths: paths,
    forbiddenPaths: forbidden,
    fileCount: paths.length,
    addedLines: added,
    deletedLines: deleted,
    diffBytes: Buffer.byteLength(diff, "utf8"),
    checks
  };

  const decision = failures.length ? "KILL" : "PASS";
  const evidenceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");

  return {
    decision,
    failures,
    evidence,
    evidenceHash,
    rule: "AI claim never overrides deterministic safety gates"
  };
}

module.exports = { inspectPatch, countDiffLines, hasSecretLikeMaterial };