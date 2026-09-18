"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_FILES = 8;
const MAX_FILE_BYTES = 12000;
const BLOCKED = [/^\.env(?:\.|$)/, /^\.github\/workflows\//];

function validateFiles(files = []) {
  const list = Array.from(new Set(files.map(String))).slice(0, MAX_FILES);
  for (const file of list) {
    if (!file || file.startsWith("/") || /(^|\/)\.\.\//.test(file) || BLOCKED.some(re => re.test(file))) {
      throw new Error("UNSAFE_SOURCE_PATH");
    }
  }
  return list;
}

async function readSourceContext(workspace, changedFiles = []) {
  const root = String(workspace || "").trim();
  if (!root) throw new TypeError("workspace is required");
  const files = validateFiles(changedFiles);
  const parts = [];
  for (const file of files) {
    const full = path.resolve(root, file);
    if (full !== path.join(root, file)) throw new Error("SOURCE_PATH_ESCAPE");
    const data = await fs.readFile(full, "utf8");
    parts.push({
      path: file,
      content: data.slice(0, MAX_FILE_BYTES),
      truncated: Buffer.byteLength(data, "utf8") > MAX_FILE_BYTES
    });
  }
  return parts;
}

function formatSourceContext(files) {
  return (files || []).map(file => [
    "FILE: " + file.path,
    file.truncated ? "[TRUNCATED]" : "",
    file.content
  ].filter(Boolean).join("\n")).join("\n\n");
}

module.exports = { readSourceContext, formatSourceContext, validateFiles, MAX_FILES, MAX_FILE_BYTES };
