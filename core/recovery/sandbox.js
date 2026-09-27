"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_CHANGED_FILES = 12;
const MAX_COMMAND_OUTPUT = 12000;
const DEFAULT_TIMEOUT_MS = 120000;

function safeRelativePath(p) {
  const value = String(p || "");
  return Boolean(
    value &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

function safeRepoDir(p) {
  const value = String(p || "").trim();
  if (!value || value.includes("\0")) return false;
  const resolved = path.resolve(value);
  return path.isAbsolute(resolved);
}

function commandTimeout() {
  const value = Number(process.env.NEXUS_SANDBOX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10 * 60 * 1000) : DEFAULT_TIMEOUT_MS;
}

function execAllowed(cwd, command, args = [], timeout = commandTimeout()) {
  const allowed = new Set(["git", "npm"]);
  if (!allowed.has(command)) throw new Error("SANDBOX_COMMAND_NOT_ALLOWED");
  if (!Array.isArray(args) || args.length > 16 || args.some(x => String(x).length > 512)) {
    throw new Error("SANDBOX_ARGUMENT_LIMIT");
  }

  const safeArgs = args.map(String);
  if (command === "git") {
    const gitAllowed = [
      ["diff", "--check"],
      ["status", "--porcelain"],
    ];
    const ok = gitAllowed.some(prefix =>
      safeArgs.length === prefix.length && prefix.every((v, i) => safeArgs[i] === v)
    );
    if (!ok) throw new Error("SANDBOX_GIT_COMMAND_NOT_ALLOWED");
  } else {
    if (safeArgs.length !== 1 || safeArgs[0] !== "test") {
      throw new Error("SANDBOX_NPM_COMMAND_NOT_ALLOWED");
    }
  }

  return execFileSync(command, safeArgs, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_COMMAND_OUTPUT,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function applyDiff(repoDir, diff) {
  if (!safeRepoDir(repoDir)) throw new Error("SANDBOX_REPO_REQUIRED");
  if (!diff) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");

  return execFileSync(
    "git",
    ["apply", "--check", "--whitespace=error-all", "-"],
    {
      cwd: repoDir,
      input: diff,
      encoding: "utf8",
      timeout: Math.min(commandTimeout(), 30000),
      maxBuffer: MAX_COMMAND_OUTPUT
    }
  );
}

function changedFilesFromDiff(diff) {
  return [
    ...new Set(
      (String(diff).match(/^diff --git a\/([^ ]+) b\/([^ ]+)$/gm) || [])
        .map(line => {
          const match = /^diff --git a\/([^ ]+) b\/([^ ]+)$/.exec(line);
          return match ? match[2] : null;
        })
        .filter(Boolean)
    )
  ];
}

function verify({ diff, repoDir, testCommand = "npm", testArgs = ["test"] }) {
  if (!safeRepoDir(repoDir)) throw new Error("SANDBOX_REPO_REQUIRED");
  if (!diff) throw new Error("PATCH_DIFF_REQUIRED");
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) throw new Error("PATCH_TOO_LARGE");

  if (testCommand !== "npm" || !Array.isArray(testArgs) || testArgs.length !== 1 || String(testArgs[0]) !== "test") {
    throw new Error("SANDBOX_TEST_COMMAND_NOT_ALLOWED");
  }

  const files = changedFilesFromDiff(diff);
  if (!files.length) throw new Error("SANDBOX_NO_CHANGED_FILES");
  if (files.length > MAX_CHANGED_FILES) throw new Error("SANDBOX_FILE_LIMIT");
  if (files.some(file => !safeRelativePath(file))) throw new Error("SANDBOX_UNSAFE_PATH");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-sandbox-"));
  try {
    execFileSync(
      "git",
      ["clone", "--no-local", "--", path.resolve(repoDir), temp],
      {
        encoding: "utf8",
        timeout: Math.min(commandTimeout(), 120000),
        maxBuffer: MAX_COMMAND_OUTPUT
      }
    );

    applyDiff(temp, diff);

    execFileSync(
      "git",
      ["apply", "--whitespace=error-all", "-"],
      {
        cwd: temp,
        input: diff,
        encoding: "utf8",
        timeout: Math.min(commandTimeout(), 30000),
        maxBuffer: MAX_COMMAND_OUTPUT
      }
    );

    execAllowed(temp, "git", ["diff", "--check"]);
    execAllowed(temp, "npm", ["test"]);

    return {
      ok: true,
      status: "sandbox_verified",
      changedFiles: files,
      testCommand: ["npm", "test"],
      timeoutMs: commandTimeout(),
      proofHash: crypto.createHash("sha256").update(diff).digest("hex")
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = {
  verify,
  applyDiff,
  runCommand: execAllowed,
  safeRelativePath,
  safeRepoDir
};
