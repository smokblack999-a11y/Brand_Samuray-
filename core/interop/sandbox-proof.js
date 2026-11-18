"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
  const testScript = process.env.NODE_ENV === "test" && process.env.NEXUS_GH_TEST_EXEC;
  const command = testScript ? process.execPath : "gh";
  const commandArgs = testScript ? [testScript, ...args] : args;
  return execFileAsync(command, commandArgs, {
    timeout: options.timeoutMs || 20000,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: {...process.env, GH_PROMPT_DISABLED: "1"}
  });
}


async function verifySandboxRun({runId, repository, headSha} = {}) {
  if (!/^[1-9][0-9]*$/.test(String(runId || "")) ||
      !validRepository(repository) ||
      !isSha(headSha)) {
    throw new Error("SANDBOX_RUN_EXPECTED_CONTEXT_INVALID");
  }

  let result;
  try {
    result = await runGh([
      "run", "view", String(runId),
      "--repo", repository,
      "--json", "status,conclusion,headSha,workflowName,event"
    ]);
  } catch (error) {
    throw new Error("SANDBOX_RUN_LOOKUP_FAILED:" + String(error.message || error).slice(0, 300));
  }

  let run;
  try {
    run = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("SANDBOX_RUN_OUTPUT_INVALID");
  }
  if (!run || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("SANDBOX_RUN_NOT_SUCCESSFUL");
  }
  if (String(run.headSha || "").toLowerCase() !== headSha.toLowerCase()) {
    throw new Error("SANDBOX_RUN_HEAD_MISMATCH");
  }
  if (run.workflowName !== "SAMURAI NEXUS Isolated Patch Sandbox" || run.event !== "pull_request") {
    throw new Error("SANDBOX_RUN_IDENTITY_MISMATCH");
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

async function verifySandboxAttestation({receiptPath, patchPath, expected} = {}) {
  if (typeof receiptPath !== "string" || typeof patchPath !== "string") {
    throw new Error("SANDBOX_EVIDENCE_PATHS_REQUIRED");
  }

  let evidenceRoot;
  let receiptFile;
  let patchFile;
  let receipt;
  try {
    const evidenceRootSetting = process.env.NEXUS_EVIDENCE_DIR ||
      path.resolve(__dirname, "../data/nexus-evidence");
    fs.mkdirSync(path.resolve(evidenceRootSetting), {recursive: true});
    evidenceRoot = fs.realpathSync(path.resolve(evidenceRootSetting));
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

  const sandboxRun = await verifySandboxRun({
    runId: validated.workflowRunId,
    repository: validated.repository,
    headSha: validated.headSha
  });

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
    sandboxRun,
    verifiedAt: new Date().toISOString()
  });
}


function errorWithCode(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeEvidenceFile(root, relativePath) {
  const rootReal = fs.realpathSync(root);
  const target = path.resolve(rootReal, relativePath);
  const relative = path.relative(rootReal, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw errorWithCode("SANDBOX_ARTIFACT_PATH_BLOCKED");
  }

  let cursor = rootReal;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw errorWithCode("SANDBOX_ARTIFACT_SYMLINK_BLOCKED");
  }

  const real = fs.realpathSync(target);
  const realRelative = path.relative(rootReal, real);
  if (!realRelative || realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) {
    throw errorWithCode("SANDBOX_ARTIFACT_PATH_BLOCKED");
  }
  if (!fs.statSync(real).isFile()) throw errorWithCode("SANDBOX_ARTIFACT_FILE_REQUIRED");
  return real;
}

async function findSandboxRun({repository, headSha} = {}) {
  if (!validRepository(repository) || !isSha(headSha)) {
    throw errorWithCode("SANDBOX_RUN_EXPECTED_CONTEXT_INVALID");
  }

  let result;
  try {
    result = await runGh([
      "run", "list",
      "--repo", repository,
      "--workflow", SANDBOX_WORKFLOW,
      "--commit", headSha.toLowerCase(),
      "--event", "pull_request",
      "--json", "databaseId,status,conclusion,headSha,workflowName,event,createdAt",
      "--limit", "20"
    ]);
  } catch (error) {
    throw errorWithCode("SANDBOX_RUN_DISCOVERY_FAILED", String(error.message || error).slice(0, 300));
  }

  let runs;
  try {
    runs = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw errorWithCode("SANDBOX_RUN_DISCOVERY_OUTPUT_INVALID");
  }
  if (!Array.isArray(runs)) throw errorWithCode("SANDBOX_RUN_DISCOVERY_OUTPUT_INVALID");

  const matches = runs.filter(run =>
    String(run.headSha || "").toLowerCase() === headSha.toLowerCase() &&
    run.workflowName === "SAMURAI NEXUS Isolated Patch Sandbox" &&
    run.event === "pull_request" &&
    /^[1-9][0-9]*$/.test(String(run.databaseId || ""))
  ).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  if (!matches.length) throw errorWithCode("SANDBOX_RUN_NOT_FOUND");
  const latest = matches[0];
  if (latest.status !== "completed" || latest.conclusion !== "success") {
    throw errorWithCode("SANDBOX_LATEST_RUN_NOT_SUCCESSFUL");
  }
  return String(latest.databaseId);
}

function sameEvidenceFiles(directory, patchBytes, receiptBytes) {
  try {
    const patchPath = path.join(directory, "candidate.patch");
    const receiptPath = path.join(directory, "receipt.json");
    const patchStat = fs.lstatSync(patchPath);
    const receiptStat = fs.lstatSync(receiptPath);
    if (!patchStat.isFile() || patchStat.isSymbolicLink() ||
        !receiptStat.isFile() || receiptStat.isSymbolicLink()) return false;
    return sha256(fs.readFileSync(patchPath)) === sha256(patchBytes) &&
      sha256(fs.readFileSync(receiptPath)) === sha256(receiptBytes);
  } catch {
    return false;
  }
}

async function ingestSandboxArtifact({runId, expected, evidenceRoot} = {}) {
  if (!validRepository(expected?.repository) ||
      !isSha(expected?.baseSha) ||
      !isSha(expected?.headSha)) {
    throw errorWithCode("SANDBOX_EXPECTED_CONTEXT_INVALID");
  }

  const resolvedRunId = runId === undefined || runId === null || runId === ""
    ? await findSandboxRun({repository: expected.repository, headSha: expected.headSha})
    : String(runId);
  if (!/^[1-9][0-9]*$/.test(resolvedRunId)) {
    throw errorWithCode("SANDBOX_RUN_ID_INVALID");
  }

  const sandboxRun = await verifySandboxRun({
    runId: resolvedRunId,
    repository: expected.repository,
    headSha: expected.headSha
  });

  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-sandbox-download-"));
  let stagingDirectory = null;
  try {
    const artifactName = "nexus-sandbox-evidence-" + resolvedRunId;
    try {
      await runGh([
        "run", "download", resolvedRunId,
        "--repo", expected.repository,
        "--name", artifactName,
        "--dir", downloadRoot
      ], {timeoutMs: 60000});
    } catch (error) {
      throw errorWithCode("SANDBOX_ARTIFACT_DOWNLOAD_FAILED", String(error.message || error).slice(0, 300));
    }

    let patchPath;
    let receiptPath;
    let testLogPath;
    try {
      patchPath = safeEvidenceFile(downloadRoot, "candidate.patch");
      receiptPath = safeEvidenceFile(downloadRoot, path.join("nexus-evidence", "receipt.json"));
      testLogPath = safeEvidenceFile(downloadRoot, "nexus-test.log");
    } catch (error) {
      if (error.code) throw error;
      throw errorWithCode("SANDBOX_ARTIFACT_LAYOUT_INVALID", String(error.message || error));
    }

    const patchBytes = fs.readFileSync(patchPath);
    const receiptBytes = fs.readFileSync(receiptPath);
    const testLogBytes = fs.readFileSync(testLogPath);
    let receipt;
    try {
      receipt = JSON.parse(receiptBytes.toString("utf8"));
    } catch {
      throw errorWithCode("SANDBOX_ARTIFACT_RECEIPT_INVALID");
    }

    const validated = validateSandboxReceipt(receipt, expected, patchBytes);
    if (validated.workflowRunId !== resolvedRunId) {
      throw errorWithCode("SANDBOX_RECEIPT_RUN_ID_MISMATCH");
    }
    if (sha256(testLogBytes) !== validated.testLogSha256) {
      throw errorWithCode("SANDBOX_TEST_LOG_DIGEST_MISMATCH");
    }

    const rootSetting = evidenceRoot ||
      process.env.NEXUS_EVIDENCE_DIR ||
      path.resolve(__dirname, "../data/nexus-evidence");
    fs.mkdirSync(path.resolve(rootSetting), {recursive: true, mode: 0o700});
    const durableRoot = fs.realpathSync(path.resolve(rootSetting));
    const destination = path.join(durableRoot, "run-" + resolvedRunId);

    if (fs.existsSync(destination)) {
      if (!fs.lstatSync(destination).isDirectory() ||
          fs.lstatSync(destination).isSymbolicLink() ||
          !sameEvidenceFiles(destination, patchBytes, receiptBytes)) {
        throw errorWithCode("SANDBOX_EVIDENCE_CONFLICT");
      }
    } else {
      stagingDirectory = fs.mkdtempSync(path.join(durableRoot, ".ingest-" + resolvedRunId + "-"));
      fs.chmodSync(stagingDirectory, 0o700);
      fs.writeFileSync(path.join(stagingDirectory, "candidate.patch"), patchBytes, {flag: "wx", mode: 0o600});
      fs.writeFileSync(path.join(stagingDirectory, "receipt.json"), receiptBytes, {flag: "wx", mode: 0o600});
      try {
        fs.renameSync(stagingDirectory, destination);
        stagingDirectory = null;
      } catch (error) {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
        if (!sameEvidenceFiles(destination, patchBytes, receiptBytes)) {
          throw errorWithCode("SANDBOX_EVIDENCE_CONFLICT");
        }
      }
    }

    return Object.freeze({
      runId: resolvedRunId,
      artifactName,
      receiptPath: path.join(destination, "receipt.json"),
      patchPath: path.join(destination, "candidate.patch"),
      patchSha256: validated.patchSha256,
      receiptFileSha256: sha256(receiptBytes),
      sandboxRun
    });
  } finally {
    if (stagingDirectory && fs.existsSync(stagingDirectory)) {
      fs.rmSync(stagingDirectory, {recursive: true, force: true});
    }
    fs.rmSync(downloadRoot, {recursive: true, force: true});
  }
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
  verifySandboxRun,
  findSandboxRun,
  ingestSandboxArtifact,
  verifyCiRun
};
