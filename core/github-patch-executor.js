"use strict";

const path = require("path");

const MAX_PATCHES = 20;
const MAX_FILE_BYTES = 200000;
const MAX_TOTAL_BYTES = 1000000;

// AI may describe a repair, but it never supplies executable shell commands.
// Only explicit UTF-8 file replacements are accepted.
const DENY_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_dsa|authorized_keys)$/i,
  /(^|\/)(?:secrets?|credentials?)(?:\.|\/|$)/i,
  /^\.github\/workflows\//i,
  /(^|\/)node_modules\//i,
  /(^|\/)\.git\//i
];

function normalizePath(input) {
  const value = String(input || "").replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.includes("\0")) {
    throw new Error("Unsafe patch path");
  }
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Path traversal is not allowed");
  }
  if (DENY_PATTERNS.some(re => re.test(normalized))) {
    throw new Error(`Protected path is not patchable: ${normalized}`);
  }
  return normalized;
}

function validatePatches(patches) {
  if (!Array.isArray(patches) || patches.length < 1 || patches.length > MAX_PATCHES) {
    throw new Error(`patches must contain 1..${MAX_PATCHES} entries`);
  }
  let total = 0;
  const seen = new Set();
  const normalized = patches.map(item => {
    if (!item || typeof item !== "object") throw new Error("Invalid patch entry");
    const filePath = normalizePath(item.path);
    if (seen.has(filePath)) throw new Error(`Duplicate patch path: ${filePath}`);
    seen.add(filePath);
    if (typeof item.content !== "string") throw new Error(`Patch content must be a string: ${filePath}`);
    const bytes = Buffer.byteLength(item.content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`Patch too large: ${filePath}`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) throw new Error("Total patch size exceeds safety limit");
    return { path: filePath, content: item.content };
  });
  return normalized;
}

function validateAffectedFiles(diagnosis, patches) {
  const affected = Array.isArray(diagnosis?.affected_files)
    ? diagnosis.affected_files.map(normalizePath)
    : [];
  if (affected.length === 0) throw new Error("Diagnosis affected_files is required");
  const allowed = new Set(affected);
  for (const patch of patches) {
    if (!allowed.has(patch.path)) {
      throw new Error(`Patch is outside diagnosed affected_files: ${patch.path}`);
    }
  }
  return patches;
}

function validateDiagnosis(diagnosis) {
  if (!diagnosis || typeof diagnosis !== "object") throw new Error("Diagnosis is required");
  if (diagnosis.patch_ready !== true) throw new Error("Diagnosis is not patch-ready");
  if (Array.isArray(diagnosis.blockers) && diagnosis.blockers.length) {
    throw new Error("Diagnosis contains blockers");
  }
  if (Number(diagnosis.confidence) < 0.7) throw new Error("Diagnosis confidence is below 0.7");
  return diagnosis;
}

async function executePatch({
  job,
  diagnosis,
  patches,
  sandbox,
  gitHub
}) {
  validateDiagnosis(diagnosis);
  const safePatches = validateAffectedFiles(diagnosis, validatePatches(patches));

  if (!job || !job.repository || !job.headSha) throw new Error("Job repository/headSha is required");
  if (!sandbox || typeof sandbox.applyAndTest !== "function") {
    throw new Error("Sandbox adapter is required");
  }
  if (!gitHub || typeof gitHub.createBranch !== "function" ||
      typeof gitHub.applyFiles !== "function" ||
      typeof gitHub.createPullRequest !== "function") {
    throw new Error("GitHub adapter is incomplete");
  }

  const shortSha = String(job.headSha).slice(0, 8) || "unknown";
  const branchName = `repair/${job.id}-${shortSha}`;

  // Sandbox is mandatory and happens before any GitHub mutation.
  const sandboxResult = await sandbox.applyAndTest({
    repository: job.repository,
    baseSha: job.headSha,
    patches: safePatches,
    tests: Array.isArray(diagnosis.tests_to_run) ? diagnosis.tests_to_run : []
  });
  if (!sandboxResult || sandboxResult.passed !== true) {
    throw new Error("Sandbox verification failed; no repair branch or PR was created");
  }

  await gitHub.createBranch({
    repository: job.repository,
    branchName,
    baseSha: job.headSha
  });

  await gitHub.applyFiles({
    repository: job.repository,
    branchName,
    patches: safePatches,
    message: `fix: X18 automated repair for ${job.id}`
  });

  const pr = await gitHub.createPullRequest({
    repository: job.repository,
    head: branchName,
    base: "main",
    title: `fix: X18 automated repair ${job.id}`,
    body: [
      "Automated X18 repair proposal.",
      "",
      `Source CI run: ${job.runId}`,
      `Diagnosis confidence: ${Number(diagnosis.confidence).toFixed(2)}`,
      "",
      "Sandbox verification passed before branch mutation.",
      "This PR is intentionally created for review; it is not auto-merged."
    ].join("\n"),
    draft: true
  });

  return { branchName, sandbox: sandboxResult, pr };
}

module.exports = { normalizePath, validatePatches, validateDiagnosis, validateAffectedFiles, executePatch };
