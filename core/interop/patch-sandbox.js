"use strict";

const crypto = require("node:crypto");

const MAX_SANDBOX_FILES = 20;

function validateSandboxFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("SANDBOX_FILES_REQUIRED");
  }
  if (files.length > MAX_SANDBOX_FILES) {
    throw new Error("SANDBOX_TOO_MANY_FILES");
  }

  const normalized = [...new Set(files.map(file => String(file || "")))];
  for (const file of normalized) {
    if (file.includes("\\") || file.split("/").some(part =>
      !part || part === "." || part === ".." || part.toLowerCase() === ".git"
    )) {
      throw new Error("SANDBOX_PATH_BLOCKED");
    }
    if (!file.startsWith("core/") || !file.endsWith(".js")) {
      throw new Error("SANDBOX_FILE_TYPE_BLOCKED");
    }
    if (/^core\/(?:node_modules|\.git|data)(?:\/|$)/i.test(file) ||
        /(?:^|\/)(?:\.env(?:\.|$)|package(?:-lock)?\.json$|Dockerfile$)/i.test(file)) {
      throw new Error("SANDBOX_SENSITIVE_PATH_BLOCKED");
    }
  }
  return normalized;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createSandboxReceipt({
  repository,
  baseSha,
  headSha,
  patch,
  testLog,
  runId,
  conclusion
} = {}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || "")) ||
      !/^[a-f0-9]{40}$/i.test(String(baseSha || "")) ||
      !/^[a-f0-9]{40}$/i.test(String(headSha || "")) ||
      !String(patch || "") ||
      !["success", "failure"].includes(conclusion) ||
      !String(runId || "")) {
    throw new Error("SANDBOX_RECEIPT_INPUT_INVALID");
  }

  const receipt = {
    schema: "samurai-nexus-sandbox-receipt/v1",
    repository,
    baseSha: baseSha.toLowerCase(),
    headSha: headSha.toLowerCase(),
    patchSha256: sha256(Buffer.from(patch)),
    testLogSha256: sha256(Buffer.from(String(testLog || ""))),
    workflowRunId: String(runId),
    conclusion,
    runner: "github-hosted-ephemeral-docker-v1",
    networkDuringTests: "none",
    secretsAvailableToTestContainer: false,
    createdAt: new Date().toISOString()
  };

  return {
    ...receipt,
    receiptSha256: sha256(Buffer.from(JSON.stringify(receipt)))
  };
}

module.exports = { MAX_SANDBOX_FILES, validateSandboxFiles, createSandboxReceipt };
