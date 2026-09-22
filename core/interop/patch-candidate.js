"use strict";

const MAX_PATCH_BYTES = 256 * 1024;

function validateUnifiedDiff(input = "") {
  const diff = String(input || "");
  if (!diff) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");

  const lines = diff.split(/\r?\n/);
  const files = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/([^ ]+) b\/([^ ]+)$/.exec(line);
      if (!m) throw new Error("INVALID_DIFF_HEADER");
      if (m[1] !== m[2]) throw new Error("RENAME_NOT_ALLOWED");
      current = m[2];
      files.push(current);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@ ") ||
        line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") ||
        line === "\\ No newline at end of file" || line === "") continue;
    if (line.startsWith("index ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ")) continue;
    throw new Error("INVALID_DIFF_LINE");
  }

  if (!files.length) throw new Error("NO_CHANGED_FILES");
  if (files.some(file => file.startsWith("/") || file.includes("..") || file.includes("\\") || file.includes("\0"))) {
    throw new Error("UNSAFE_PATH");
  }

  return { diff, files: [...new Set(files)] };
}

function buildPatchCandidate(input = {}) {
  const diff = String(input.diff || "");
  let validated;
  try {
    validated = validateUnifiedDiff(diff);
  } catch (error) {
    return { accepted: false, reason: String(error?.message || error) };
  }

  const suppliedFiles = Array.isArray(input.changedFiles) ? input.changedFiles.filter(Boolean) : [];
  if (suppliedFiles.length && validated.files.some(file => !suppliedFiles.includes(file))) {
    return { accepted: false, reason: "PATCH_TOUCHES_UNRELATED_FILE" };
  }

  return {
    accepted: true,
    source: String(input.source || "external-candidate"),
    candidate: {
      version: 1,
      diff: validated.diff,
      files: validated.files,
      evidenceOnly: true,
      reproduction: false,
      causality: false,
      requiresSandbox: true,
      autonomousWrite: false,
      autonomousMerge: false
    }
  };
}

module.exports = { MAX_PATCH_BYTES, validateUnifiedDiff, buildPatchCandidate };
