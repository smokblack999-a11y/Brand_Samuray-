"use strict";

const { FORBIDDEN_PATHS } = require("./nexus-patch-proposal");

function inspectPatch({ proposal, changedPaths = [], diffText = "" } = {}) {
  if (!proposal) throw new Error("proposal is required");
  const paths = [...new Set(changedPaths.map(String).map((p) => p.trim()).filter(Boolean))];
  const forbidden = paths.filter((p) => FORBIDDEN_PATHS.some((r) => r.test(p)));
  const diff = String(diffText || "");
  const oversized = paths.length > Number(proposal.scope?.maxFiles || 3);
  const secretLike = /(BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|password\s*[:=]|token\s*[:=])/i.test(diff);
  const workflowMutation = paths.some((p) => /^\.github\/workflows\//i.test(p));
  const empty = !diff.trim();

  const failures = [];
  if (proposal.status !== "PATCH_CANDIDATE") failures.push("proposal_not_bounded");
  if (forbidden.length) failures.push("forbidden_paths");
  if (oversized) failures.push("scope_too_large");
  if (secretLike) failures.push("secret_like_material");
  if (workflowMutation) failures.push("workflow_mutation");
  if (empty) failures.push("missing_diff");

  return {
    decision: failures.length ? "KILL" : "PASS",
    failures,
    evidence: {
      changedPaths: paths,
      forbiddenPaths: forbidden,
      fileCount: paths.length,
      diffBytes: Buffer.byteLength(diff, "utf8"),
      workflowMutation,
      secretLike,
      empty
    },
    rule: "AI claim never overrides deterministic safety gates"
  };
}

module.exports = { inspectPatch };
