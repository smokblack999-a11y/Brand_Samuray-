"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const SANDBOX_RECEIPT_SCHEMA = "samurai-nexus-sandbox-receipt/v1";
const SANDBOX_PROOF_SCHEMA = "nexus-verified-sandbox-proof/v1";
const SLSA_PREDICATE = "https://slsa.dev/provenance/v1";
const SANDBOX_WORKFLOW = ".github/workflows/nexus-sandbox.yml";
const CI_WORKFLOWS = new Set(["SamuraiOS Core CI", "SamuraiOS Core X22 CI"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value || ""));
}

function validRepository(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || ""));
}

function receiptPayload(receipt) {
  const payload = {...receipt};
  delete payload.receiptSha256;
  return payload;
}

function validateSandboxReceipt(receipt, expected, patchBytes) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("SANDBOX_RECEIPT_INVALID");
  }
  if (!validRepository(expected?.repository) ||
      !isSha(expected?.baseSha) ||
      !isSha(expected?.headSha)) {
    throw new Error("SANDBOX_EXPECTED_CONTEXT_INVALID");
  }
  if (receipt.schema !== SANDBOX_RECEIPT_SCHEMA ||
      receipt.repository !== expected.repository ||
      String(receipt.baseSha || "").toLowerCase() !== expected.baseSha.toLowerCase() ||
      String(receipt.headSha || "").toLowerCase() !== expected.headSha.toLowerCase()) {
    throw new Error("SANDBOX_RECEIPT_SUBJECT_MISMATCH");
  }
  if (receipt.conclusion !== "success" ||
      receipt.runner !== "github-hosted-ephemeral-docker-v1" ||
      receipt.networkDuringTests !== "none" ||
      receipt.secretsAvailableToTestContainer !== false) {
    throw new Error("SANDBOX_RECEIPT_POLICY_MISMATCH");
  }
  if (!/^[1-9][0-9]*$/.test(String(receipt.workflowRunId || "")) ||
      !/^[a-f0-9]{64}$/i.test(String(receipt.testLogSha256 || "")) ||
      !Number.isFinite(Date.parse(receipt.createdAt))) {
    throw new Error("SANDBOX_RECEIPT_FIELDS_INVALID");
  }

  const actualPatchSha256 = sha256(patchBytes);
  if (String(receipt.patchSha256 || "").toLowerCase() !== actualPatchSha256) {
    throw new Error("SANDBOX_PATCH_DIGEST_MISMATCH");
  }

  const expectedReceiptSha256 = sha256(Buffer.from(JSON.stringify(receiptPayload(receipt))));
  if (String(receipt.receiptSha256 || "").toLowerCase() !== expectedReceiptSha256) {
    throw new Error("SANDBOX_RECEIPT_DIGEST_MISMATCH");
  }

  return {
    repository: receipt.repository,
    baseSha: receipt.baseSha.toLowerCase(),
    headSha: receipt.headSha.toLowerCase(),
    patchSha256: actualPatchSha256,
    testLogSha256: receipt.testLogSha256.toLowerCase(),
    workflowRunId: String(receipt.workflowRunId),
    createdAt: receipt.createdAt
  };
}

async function runGh(args, options = {}) {
  return execFileAsync("gh", args, {
    timeout: options.timeoutMs || 20000,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: {...process.env, GH_PROMPT_DISABLED: "1"}
  });
}

async function verifySandboxAttestation({receiptPath, patchPath, expected} = {}) {
  if (typeof receiptPath !== "string" || typeof patchPath !== "string") {
    throw new Error("SANDBOX_EVIDENCE_PATHS_REQUIRED");
  }

  let evidenceRoot;
  let receiptFile;
  let patchFile;
  let receipt;
  try {
    if (!process.env.NEXUS_EVIDENCE_DIR) {
      throw new Error("NEXUS_EVIDENCE_DIR is not configured");
    }
    evidenceRoot = fs.realpathSync(path.resolve(process.env.NEXUS_EVIDENCE_DIR));
    receiptFile = fs.realpathSync(path.resolve(receiptPath));
    patchFile = fs.realpathSync(path.resolve(patchPath));
    for (const file of [receiptFile, patchFile]) {
      const relative = path.relative(evidenceRoot, file);
      if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
        throw new Error("evidence_path_outside_root");
      }
    }
    receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  } catch (error) {
    throw new Error("SANDBOX_EVIDENCE_UNREADABLE:" + String(error.message || error));
  }
  const patchBytes = fs.readFileSync(patchFile);
  const validated = validateSandboxReceipt(receipt, expected, patchBytes);

  const signerWorkflow = "github.com/" + expected.repository + "/" + SANDBOX_WORKFLOW;
  let result;
  try {
    result = await runGh([
      "attestation", "verify", receiptFile,
      "--repo", expected.repository,
      "--signer-workflow", signerWorkflow,
      "--source-digest", expected.headSha.toLowerCase(),
      "--predicate-type", SLSA_PREDICATE,
      "--format", "json"
    ]);
  } catch (error) {
    throw new Error("SANDBOX_ATTESTATION_VERIFICATION_FAILED:" + String(error.message || error).slice(0, 300));
  }

  let attestations;
  try {
    attestations = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("SANDBOX_ATTESTATION_OUTPUT_INVALID");
  }
  if (!Array.isArray(attestations) || attestations.length === 0) {
    throw new Error("SANDBOX_ATTESTATION_NOT_FOUND");
  }

  return Object.freeze({
    schema: SANDBOX_PROOF_SCHEMA,
    verified: true,
    verifier: "gh-attestation-verify",
    repository: validated.repository,
    baseSha: validated.baseSha,
    headSha: validated.headSha,
    patchSha256: validated.patchSha256,
    workflowRunId: validated.workflowRunId,
    receiptFileSha256: sha256(fs.readFileSync(receiptFile)),
    signerWorkflow,
    predicateType: SLSA_PREDICATE,
    attestationCount: attestations.length,
    verifiedAt: new Date().toISOString()
  });
}

async function verifyCiRun({runId, repository, headSha} = {}) {
  if (!/^[1-9][0-9]*$/.test(String(runId || "")) ||
      !validRepository(repository) ||
      !isSha(headSha)) {
    throw new Error("CI_EXPECTED_CONTEXT_INVALID");
  }

  let result;
  try {
    result = await runGh([
      "run", "view", String(runId),
      "--repo", repository,
      "--json", "status,conclusion,headSha,workflowName,event"
    ]);
  } catch (error) {
    throw new Error("CI_RUN_LOOKUP_FAILED:" + String(error.message || error).slice(0, 300));
  }

  let run;
  try {
    run = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("CI_RUN_OUTPUT_INVALID");
  }
  if (!run || run.status !== "completed") {
    throw new Error("CI_RUN_NOT_COMPLETED");
  }
  if (String(run.headSha || "").toLowerCase() !== headSha.toLowerCase()) {
    throw new Error("CI_RUN_HEAD_MISMATCH");
  }
  if (!CI_WORKFLOWS.has(run.workflowName) || run.event !== "pull_request") {
    throw new Error("CI_RUN_IDENTITY_MISMATCH");
  }
  if (!["success", "failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion)) {
    throw new Error("CI_RUN_CONCLUSION_INVALID");
  }

  return Object.freeze({
    verified: true,
    verifier: "gh-run-view",
    repository,
    runId: String(runId),
    headSha: run.headSha.toLowerCase(),
    workflowName: run.workflowName,
    event: run.event,
    conclusion: run.conclusion,
    verifiedAt: new Date().toISOString()
  });
}

module.exports = {
  SANDBOX_RECEIPT_SCHEMA,
  SANDBOX_PROOF_SCHEMA,
  SLSA_PREDICATE,
  SANDBOX_WORKFLOW,
  CI_WORKFLOWS,
  sha256,
  validateSandboxReceipt,
  verifySandboxAttestation,
  verifyCiRun
};
