"use strict";

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { createEvidenceRecord } = require("./evidence-verifier");

const execFileAsync = promisify(execFile);
const REPO_DIR = path.resolve(__dirname, "../..");
const CORE_DIR = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function runnerStatus() {
  const keyConfigured = String(process.env.EVIDENCE_SIGNING_KEY || "").length >= 32;
  return {
    enabled: keyConfigured,
    profile: "samurai-core-tests",
    commands: ["git rev-parse HEAD", "git status --porcelain --untracked-files=no", "npm test"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    reason: keyConfigured ? null : "EVIDENCE_SIGNING_KEY_MISSING"
  };
}

async function runFixed(executable, args, cwd, timeout) {
  return execFileAsync(executable, args, {
    cwd,
    timeout,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      TMPDIR: process.env.TMPDIR || "",
      CI: "1",
      NODE_ENV: "test"
    }
  });
}

async function runCoreTests({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const config = runnerStatus();
  if (!config.enabled) {
    return { status: "BLOCKED", reason: config.reason, checks: [], receipt: null };
  }

  const timeout = Math.max(1000, Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
  const startedAt = new Date().toISOString();
  let head;
  let before;
  try {
    [head, before] = await Promise.all([
      runFixed("git", ["rev-parse", "HEAD"], REPO_DIR, 5000),
      runFixed("git", ["status", "--porcelain", "--untracked-files=no"], REPO_DIR, 5000)
    ]);
  } catch (error) {
    return {
      status: "BLOCKED",
      reason: "GIT_METADATA_UNAVAILABLE",
      detail: String(error.message || error).slice(0, 500),
      checks: [],
      receipt: null
    };
  }

  const commit = String(head.stdout || "").trim();
  const beforeStatus = String(before.stdout || "");
  if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
    return { status: "BLOCKED", reason: "INVALID_GIT_HEAD", checks: [], receipt: null };
  }

  let result;
  try {
    result = await runFixed("npm", ["test"], CORE_DIR, timeout);
  } catch (error) {
    const output = [error.stdout || "", error.stderr || "", error.message || "execution_failed"].join("\n");
    return {
      status: "FAILED",
      reason: error.killed ? "TIMEOUT_OR_TERMINATED" : "TESTS_FAILED",
      workspace: { commit, clean: beforeStatus.length === 0, workingTreeDigest: sha256(beforeStatus) },
      checks: [{
        name: "core-tests",
        status: "failed",
        exitCode: Number.isInteger(error.code) ? error.code : null,
        output: output.slice(-12000),
        startedAt,
        completedAt: new Date().toISOString()
      }],
      receipt: null
    };
  }

  let after;
  try {
    after = await runFixed("git", ["status", "--porcelain", "--untracked-files=no"], REPO_DIR, 5000);
  } catch (error) {
    return { status: "BLOCKED", reason: "POST_RUN_GIT_METADATA_UNAVAILABLE", checks: [], receipt: null };
  }

  const afterStatus = String(after.stdout || "");
  if (beforeStatus !== afterStatus) {
    return {
      status: "BLOCKED",
      reason: "WORKSPACE_CHANGED_DURING_RUN",
      workspace: { commit, clean: beforeStatus.length === 0 },
      checks: [],
      receipt: null
    };
  }

  const output = [result.stdout || "", result.stderr || ""].join("\n");
  const workingTreeDigest = sha256(beforeStatus);
  const digest = sha256(JSON.stringify({
    profile: "samurai-core-tests",
    commit,
    workingTreeDigest,
    executable: "npm",
    args: ["test"],
    exitCode: 0,
    output
  }));
  const subjectHash = sha256(["SAMURAI_CORE_WORKSPACE_V1", commit, workingTreeDigest].join("\n"));
  const receipt = createEvidenceRecord({
    kind: "tests",
    digest,
    subjectHash,
    at: new Date().toISOString()
  });

  return {
    status: "PASSED",
    workspace: { commit, clean: beforeStatus.length === 0, workingTreeDigest },
    checks: [{
      name: "core-tests",
      status: "passed",
      exitCode: 0,
      output: output.slice(-12000),
      startedAt,
      completedAt: new Date().toISOString(),
      digest
    }],
    receipt
  };
}

module.exports = { runnerStatus, runCoreTests };
