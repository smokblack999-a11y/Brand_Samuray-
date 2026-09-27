"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_CHANGED_FILES = 12;
const MAX_COMMAND_OUTPUT = 12000;

function safePath(p) {
  const value = String(p || "");
  return value && !value.startsWith("/") && !value.includes("..") && !value.includes("\\") && !value.includes("\0");
}

function applyDiff(repoDir, diff) {
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");
  const proc = execFileSync("git", ["apply", "--check", "--whitespace=error-all", "-"], { cwd: repoDir, input: diff, encoding: "utf8", maxBuffer: MAX_COMMAND_OUTPUT });
  return proc;
}

function runCommand(repoDir, command, args = []) {
  if (command !== "npm") throw new Error("SANDBOX_COMMAND_NOT_ALLOWED");
  if (!Array.isArray(args) || args.length > 16 || args.some(x => String(x).length > 512)) throw new Error("SANDBOX_ARGUMENT_LIMIT");
  return execFileSync(command, args.map(String), { cwd: repoDir, encoding: "utf8", timeout: Number(process.env.NEXUS_SANDBOX_TIMEOUT_MS || 120000), maxBuffer: MAX_COMMAND_OUTPUT, stdio: ["ignore","pipe","pipe"] });
}

function verify({ diff, repoDir, testCommand = "npm", testArgs = ["test"] }) {
  if (!safePath(repoDir)) throw new Error("SANDBOX_REPO_REQUIRED");
  if (!diff) throw new Error("PATCH_DIFF_REQUIRED");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-sandbox-"));
  try {
    execFileSync("git", ["clone", "--no-local", repoDir, temp], { encoding:"utf8", timeout:120000, maxBuffer:MAX_COMMAND_OUTPUT });
    applyDiff(temp, diff);
    execFileSync("git", ["apply", "--whitespace=error-all", "-"], { cwd: temp, input: diff, encoding: "utf8", timeout: 30000, maxBuffer: MAX_COMMAND_OUTPUT });
    const files = [...new Set((diff.match(/^diff --git a\/([^ ]+) b\/([^ ]+)$/gm) || []).map(x => x.split(" ")[2].slice(2)))];
    if (!files.length || files.length > MAX_CHANGED_FILES || files.some(x => !safePath(x))) throw new Error("SANDBOX_FILE_LIMIT");
    runCommand(temp, "git", ["diff", "--check"]);
    runCommand(temp, testCommand, testArgs);
    return { ok:true, status:"sandbox_verified", changedFiles:files, testCommand:[testCommand,...testArgs], proofHash:crypto.createHash("sha256").update(diff).digest("hex") };
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
}

module.exports = { verify, applyDiff, runCommand };