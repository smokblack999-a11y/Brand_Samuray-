"use strict";

/**
 * Conservative unified-diff validator.
 * It validates structure and rejects path traversal / binary patches.
 * It does not apply the patch; application must happen in a sandbox.
 */

const MAX_PATCH_BYTES = 128 * 1024;
const MAX_FILES = 5;

function cleanPath(value) {
  const raw = String(value || "").replace(/^([ab])\//, "");
  if (!raw || raw === "/dev/null") return raw;
  if (raw.includes("\0") || raw.startsWith("/") || raw.includes("../") || raw === "..") {
    throw new Error("PATCH_UNSAFE_PATH");
  }
  return raw;
}

function validateUnifiedDiff(diff) {
  const text = String(diff || "");
  if (!text) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(text, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");
  if (/^GIT binary patch$/m.test(text) || /^Binary files /m.test(text)) {
    throw new Error("BINARY_PATCH_NOT_ALLOWED");
  }

  const lines = text.split(/\r?\n/);
  const files = [];
  let currentFile = null;
  let hasHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (!match) throw new Error("INVALID_DIFF_HEADER");
      const oldPath = cleanPath(match[1]);
      const newPath = cleanPath(match[2]);
      currentFile = newPath || oldPath;
      if (!files.includes(currentFile)) files.push(currentFile);
      if (files.length > MAX_FILES) throw new Error("TOO_MANY_PATCH_FILES");
      hasHunk = false;
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!currentFile) throw new Error("HUNK_WITHOUT_FILE");
      hasHunk = true;
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const pathToken = line.slice(4).split("\t")[0];
      if (pathToken !== "/dev/null") cleanPath(pathToken);
      continue;
    }

    if (line.startsWith("index ") || line === "new file mode" || line === "deleted file mode") {
      continue;
    }

    if (line && !line.startsWith(" ") && !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("\\")) {
      if (currentFile && !line.startsWith("similarity index") && !line.startsWith("rename from ") && !line.startsWith("rename to ")) {
        throw new Error("INVALID_PATCH_LINE");
      }
    }
  }

  if (!files.length) throw new Error("PATCH_FILE_REQUIRED");
  if (!hasHunk) throw new Error("PATCH_HUNK_REQUIRED");

  return { diff: text, files };
}

module.exports = { MAX_PATCH_BYTES, MAX_FILES, validateUnifiedDiff };
