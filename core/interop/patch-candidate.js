"use strict";

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PATCH_FILES = 20;
const MAX_PATH_LENGTH = 240;

function normalizePatchPath(raw, prefix) {
  const value = String(raw || "").trim();
  if (!value || value === "/dev/null") return value;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
    throw new Error("INVALID_PATCH_PATH");
  }
  if (value.includes("\\") || value.includes("\0") || value.length > MAX_PATH_LENGTH) {
    throw new Error("INVALID_PATCH_PATH");
  }
  const expected = prefix + "/";
  if (!value.startsWith(expected)) throw new Error("INVALID_PATCH_PATH");
  const pathValue = value.slice(expected.length);
  const segments = pathValue.split("/");
  if (!pathValue || segments.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
    throw new Error("INVALID_PATCH_PATH");
  }
  if (!/^[A-Za-z0-9._/@+ -]+$/.test(pathValue)) throw new Error("INVALID_PATCH_PATH");
  return pathValue;
}

function validateUnifiedDiff(input) {
  const diff = String(input || "");
  if (!diff) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");

  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let current = null;
  let oldPath = null;
  let newPath = null;
  let hasHunk = false;
  let fileHasHunk = false;

  function finishFile() {
    if (!current) return;
    if (!oldPath || !newPath || !fileHasHunk) throw new Error("PATCH_FILE_INCOMPLETE");
    if (oldPath !== "/dev/null" && newPath !== "/dev/null" && oldPath !== newPath) {
      throw new Error("PATCH_PATH_MISMATCH");
    }
    const actual = oldPath === "/dev/null" ? newPath : oldPath;
    if (!files.includes(actual)) files.push(actual);
    current = null;
    oldPath = null;
    newPath = null;
    fileHasHunk = false;
  }

  for (const line of lines) {
    if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      throw new Error("BINARY_PATCH_NOT_SUPPORTED");
    }
    if (/^(new|old) file mode 120000$/.test(line)) {
      throw new Error("SYMLINK_PATCH_NOT_SUPPORTED");
    }
    if (/^(rename|copy) (from|to) /.test(line)) throw new Error("PATCH_RENAME_NOT_SUPPORTED");

    if (line.startsWith("diff --git ")) {
      finishFile();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (!match) throw new Error("INVALID_PATCH_HEADER");
      const a = normalizePatchPath("a/" + match[1], "a");
      const b = normalizePatchPath("b/" + match[2], "b");
      if (a !== b) throw new Error("PATCH_PATH_MISMATCH");
      current = a;
      continue;
    }

    if (line.startsWith("--- ")) {
      if (current && (oldPath || newPath || fileHasHunk)) finishFile();
      if (!current) current = "header";
      const raw = line.slice(4).trim().split("\t")[0];
      oldPath = raw === "/dev/null" ? raw : normalizePatchPath(raw, "a");
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (!current || !oldPath || newPath) throw new Error("PATCH_HEADER_ORDER_INVALID");
      const raw = line.slice(4).trim().split("\t")[0];
      newPath = raw === "/dev/null" ? raw : normalizePatchPath(raw, "b");
      if (oldPath !== "/dev/null" && newPath !== "/dev/null" && oldPath !== newPath) {
        throw new Error("PATCH_PATH_MISMATCH");
      }
      if (current !== "header" && current !== (oldPath === "/dev/null" ? newPath : oldPath)) {
        throw new Error("PATCH_PATH_MISMATCH");
      }
      current = oldPath === "/dev/null" ? newPath : oldPath;
      continue;
    }

    if (line.startsWith("@@")) {
      if (!current || !oldPath || !newPath) throw new Error("PATCH_HUNK_WITHOUT_FILE");
      hasHunk = true;
      fileHasHunk = true;
    }
  }

  finishFile();
  if (!hasHunk) throw new Error("PATCH_HUNK_REQUIRED");
  if (!files.length) throw new Error("PATCH_FILE_REQUIRED");
  if (files.length > MAX_PATCH_FILES) throw new Error("PATCH_TOO_MANY_FILES");

  return { diff, files };
}

module.exports = { MAX_PATCH_BYTES, MAX_PATCH_FILES, validateUnifiedDiff };
