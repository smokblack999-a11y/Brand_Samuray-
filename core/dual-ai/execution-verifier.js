"use strict";

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { verifyEvidence, createEvidenceRecord, subjectHashFor, requiredEvidenceKinds } = require("./evidence-verifier");

const execFileAsync = promisify(execFile);
const CORE_DIR = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function runnerStatus() {
  const keyConfigured = String(process.env.EVIDENCE_SIGNING_KEY || "").length >= 32;
  return {
    enabled: keyConfigured,
    profile: "core-tests",
    checks: ["npm test"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    reason: keyConfigured ? null : "EVIDENCE_SIGNING_KEY_MISSING"
  };
}

async function runCoreTests({ task, answer, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const required = requiredEvidenceKinds(task, answer);
  if (!required.includes("tests")) {
    return { status: "NOT_REQUIRED", evidence: [], checks: [], verification: verifyEvidence({ task, answer }) };
  }

  const config = runnerStatus();
  if (!config.enabled) {
    return {
      status: "BLOCKED",
      reason: config.reason,
      evidence: [],
      checks: [],
      verification: verifyEvidence({ task, answer })
    };
  }

  const boundedTimeout = Math.max(1000, Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 180000));
  const startedAt = new Date().toISOString();
  const command = { executable: "npm", args: ["test"], cwd: CORE_DIR };
  let result;
  try {
    result = await execFileAsync(command.executable, command.args, {
      cwd: command.cwd,
      timeout: boundedTimeout,
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
  } catch (error) {
    const output = [error.stdout || "", error.stderr || "", error.message || "execution_failed"].join("\n");
    return {
      status: "FAILED",
      reason: error.killed ? "TIMEOUT_OR_TERMINATED" : "TESTS_FAILED",
      checks: [{
        name: "core-tests",
        status: "failed",
        exitCode: Number.isInteger(error.code) ? error.code : null,
        output: output.slice(-12000),
        startedAt,
        completedAt: new Date().toISOString()
      }],
      evidence: [],
      verification: verifyEvidence({ task, answer })
    };
  }

  const output = [result.stdout || "", result.stderr || ""].join("\n");
  const digest = sha256(JSON.stringify({
    profile: "core-tests",
    command,
    exitCode: 0,
    output
  }));
  const receipt = createEvidenceRecord({
    kind: "tests",
    digest,
    subjectHash: subjectHashFor(task, answer),
    at: new Date().toISOString()
  });
  const evidence = [receipt];
  return {
    status: "PASSED",
    checks: [{
      name: "core-tests",
      status: "passed",
      exitCode: 0,
      output: output.slice(-12000),
      startedAt,
      completedAt: new Date().toISOString(),
      digest
    }],
    evidence,
    verification: verifyEvidence({ task, answer, evidence })
  };
}

module.exports = { runnerStatus, runCoreTests };
