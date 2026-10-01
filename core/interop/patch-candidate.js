"use strict";

const MAX_PATCH_BYTES = 256 * 1024;

function validateUnifiedDiff(input) {
  const diff = String(input || "");
  if (!diff) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");

  const lines = diff.split("\n");
  const files = [];
  let current = null;
  let hasHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      current = null;
      hasHunk = false;
      continue;
    }
    if (line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim().split("\t")[0];
      const file = raw.replace(/^b\//, "").replace(/^a\//, "");
      if (!file || file === "/dev/null") continue;
      if (!/^[A-Za-z0-9._/@+\- ]+$/.test(file) || file.includes("..")) {
        throw new Error("INVALID_PATCH_PATH");
      }
      current = file;
      if (!files.includes(file)) files.push(file);
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!current) throw new Error("PATCH_HUNK_WITHOUT_FILE");
      hasHunk = true;
    }
  }

  if (!files.length) throw new Error("PATCH_FILE_REQUIRED");
  if (!hasHunk) throw new Error("PATCH_HUNK_REQUIRED");

  return { diff, files };
}

module.exports = { MAX_PATCH_BYTES, validateUnifiedDiff };
