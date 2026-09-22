"use strict";

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_FILES = 200;

function parseUnifiedDiff(diff) {
  const text = String(diff || "");
  if (!text) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(text, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");

  const lines = text.split("\n");
  const files = [];
  for (const line of lines) {
    if (!line.startsWith("+++ b/")) continue;
    const file = line.slice(6).trim();
    if (!file || file === "/dev/null") continue;
    if (file.includes("\0") || file.startsWith("/") || file.includes("../") || file.includes("\\..\\"))
      throw new Error("INVALID_PATCH_PATH");
    files.push(file);
  }
  const unique = [...new Set(files)];
  if (unique.length > MAX_FILES) throw new Error("PATCH_TOO_MANY_FILES");
  if (!unique.length) throw new Error("PATCH_FILES_REQUIRED");
  return unique;
}

function validateUnifiedDiff(diff) {
  const text = String(diff || "");
  const files = parseUnifiedDiff(text);
  if (!text.includes("diff --git ")) throw new Error("INVALID_UNIFIED_DIFF");
  return { diff: text, files };
}

module.exports = { MAX_PATCH_BYTES, MAX_FILES, parseUnifiedDiff, validateUnifiedDiff };
