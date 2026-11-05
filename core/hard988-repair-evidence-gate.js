"use strict";

const crypto = require("node:crypto");
const nexus = require("./nexus-resource-policy");

const CHECK_NAMES = Object.freeze(["sandbox", "ci"]);
const HEX_64 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SCHEMA = "hard988-repair-evidence/v1";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createCandidateBinding(input = {}) {
  const files = nexus.classifyFiles(Array.isArray(input.files) ? input.files : []).files.sort();
  return Object.freeze({
    resource: typeof input.resource === "string" ? input.resource.trim() : "",
    beforeSha: String(input.beforeSha || "").toLowerCase(),
    afterSha: String(input.afterSha || "").toLowerCase(),
    changedFilesSha256: sha256(JSON.stringify(files)),
    diffSha256: sha256(String(input.diff || ""))
  });
}

function normalizeCandidateBinding(binding) {
  if (!binding || typeof binding !== "object") return null;
  const normalized = {
    resource: String(binding.resource || "").trim(),
    beforeSha: String(binding.beforeSha || "").toLowerCase(),
    afterSha: String(binding.afterSha || "").toLowerCase(),
    changedFilesSha256: String(binding.changedFilesSha256 || "").toLowerCase(),
    diffSha256: String(binding.diffSha256 || "").toLowerCase()
  };
  if (!normalized.resource || !GIT_SHA.test(normalized.beforeSha) ||
      !GIT_SHA.test(normalized.afterSha) || !HEX_64.test(normalized.changedFilesSha256) ||
      !HEX_64.test(normalized.diffSha256)) return null;
  return normalized;
}

function canonicalCheck(check) {
  return JSON.stringify({
    checkId: String(check.checkId || ""),
    name: String(check.name || ""),
    status: String(check.status || ""),
    exitCode: check.exitCode === undefined ? null : check.exitCode,
    runnerId: String(check.runnerId || ""),
    startedAt: String(check.startedAt || ""),
    finishedAt: String(check.finishedAt || ""),
    artifactSha256: String(check.artifactSha256 || "").toLowerCase(),
    candidateBinding: normalizeCandidateBinding(check.candidateBinding)
  });
}

function validSecret(secret) {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}

function signEvidence(check, secret, candidateBinding) {
  if (!validSecret(secret)) throw new Error("hard988_secret_must_be_at_least_32_bytes");
  const binding = normalizeCandidateBinding(candidateBinding);
  if (!binding) throw new Error("hard988_candidate_binding_invalid");
  const signedCheck = { ...check, candidateBinding: binding };
  const body = canonicalCheck(signedCheck);
  return {
    checkId: String(check.checkId || ""),
    name: String(check.name || ""),
    status: String(check.status || ""),
    exitCode: check.exitCode === undefined ? null : check.exitCode,
    runnerId: String(check.runnerId || ""),
    startedAt: String(check.startedAt || ""),
    finishedAt: String(check.finishedAt || ""),
    artifactSha256: String(check.artifactSha256 || "").toLowerCase(),
    candidateBinding: binding,
    signature: crypto.createHmac("sha256", secret).update(body).digest("hex")
  };
}

function verifySignature(check, secret) {
  if (!check || !HEX_64.test(String(check.signature || "")) || !validSecret(secret)) return false;
  const expected = crypto.createHmac("sha256", secret).update(canonicalCheck(check)).digest();
  const actual = Buffer.from(String(check.signature), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function evaluateHard988(input = {}, options = {}) {
  const secret = options.secret;
  const reasons = [];
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const resource = typeof input.resource === "string" ? input.resource.trim() : "";
  const files = Array.isArray(input.files) ? input.files : [];
  const beforeSha = String(input.beforeSha || "");
  const afterSha = String(input.afterSha || "");
  const fromState = input.fromState || "CI_PASSED";
  const toState = input.toState || "READY_FOR_REVIEW";
  const expectedBinding = createCandidateBinding(input);

  if (!validSecret(secret)) addReason(reasons, "trusted_runner_secret_missing_or_too_short");
  if (!resource) addReason(reasons, "resource_identity_missing");
  if (!files.length || files.some(file => typeof file !== "string" || !file.trim())) {
    addReason(reasons, "changed_files_missing_or_invalid");
  }
  if (!GIT_SHA.test(beforeSha) || !GIT_SHA.test(afterSha)) {
    addReason(reasons, "before_after_commit_sha_invalid");
  } else if (beforeSha.toLowerCase() === afterSha.toLowerCase()) {
    addReason(reasons, "candidate_commit_not_distinct");
  }

  const policy = nexus.evaluate({
    resource,
    fromState,
    toState,
    files,
    diff: input.diff || "",
    actor: "HARD988"
  });
  if (policy.decision !== "ALLOW") {
    for (const reason of policy.reasons) addReason(reasons, "policy:" + reason);
  }

  const byName = new Map();
  const seenIds = new Set();
  for (const check of checks) {
    if (!check || typeof check !== "object") {
      addReason(reasons, "check_record_invalid");
      continue;
    }

    const name = String(check.name || "");
    if (!CHECK_NAMES.includes(name)) {
      addReason(reasons, "unexpected_check:" + (name || "unnamed"));
      continue;
    }
    if (byName.has(name)) addReason(reasons, "duplicate_check:" + name);
    else byName.set(name, check);

    const checkId = String(check.checkId || "");
    if (!checkId) addReason(reasons, "check_id_missing:" + name);
    else if (seenIds.has(checkId)) addReason(reasons, "duplicate_check_id");
    else seenIds.add(checkId);

    if (check.status !== "PASS") addReason(reasons, "check_not_passed:" + name);
    if (check.exitCode !== 0) addReason(reasons, "check_exit_code_not_zero:" + name);
    if (!String(check.runnerId || "").trim()) addReason(reasons, "runner_identity_missing:" + name);
    if (!HEX_64.test(String(check.artifactSha256 || ""))) addReason(reasons, "artifact_digest_invalid:" + name);
    if (!validTimestamp(check.startedAt) || !validTimestamp(check.finishedAt)) {
      addReason(reasons, "check_timestamps_invalid:" + name);
    } else if (Date.parse(check.finishedAt) < Date.parse(check.startedAt)) {
      addReason(reasons, "check_finished_before_start:" + name);
    }
    if (!check.candidateBinding ||
        JSON.stringify(normalizeCandidateBinding(check.candidateBinding)) !== JSON.stringify(expectedBinding)) {
      addReason(reasons, "candidate_binding_mismatch:" + name);
    }
    if (!verifySignature(check, secret)) addReason(reasons, "check_signature_invalid:" + name);
  }

  for (const required of CHECK_NAMES) {
    if (!byName.has(required)) addReason(reasons, "required_check_missing:" + required);
  }

  const sandbox = byName.get("sandbox");
  const ci = byName.get("ci");
  if (sandbox && ci && validTimestamp(sandbox.finishedAt) && validTimestamp(ci.startedAt) &&
      Date.parse(ci.startedAt) < Date.parse(sandbox.finishedAt)) {
    addReason(reasons, "ci_started_before_sandbox_finished");
  }

  const classification = nexus.classifyFiles(files);
  const blocked = reasons.length > 0;
  const evidence = checks
    .filter(check => check && typeof check === "object")
    .map(check => ({
      checkId: String(check.checkId || ""),
      name: String(check.name || ""),
      runnerId: String(check.runnerId || ""),
      artifactSha256: String(check.artifactSha256 || "").toLowerCase(),
      candidateBinding: normalizeCandidateBinding(check.candidateBinding),
      signature: String(check.signature || "")
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const receiptBody = {
    schema: SCHEMA,
    resource: resource || null,
    decision: blocked ? "BLOCK" : "READY_FOR_HUMAN_REVIEW",
    policyVersion: policy.policyVersion,
    policyEvaluationHash: policy.evaluationHash,
    beforeSha: GIT_SHA.test(beforeSha) ? beforeSha.toLowerCase() : null,
    afterSha: GIT_SHA.test(afterSha) ? afterSha.toLowerCase() : null,
    candidateBinding: expectedBinding,
    changedFiles: classification.files,
    criticality: classification.criticality,
    categories: classification.categories,
    evidence,
    reasons,
    mergeAllowed: false
  };

  return {
    ...receiptBody,
    requiredChecks: policy.requiredChecks,
    manualReviewRequired: true,
    receiptHash: sha256(JSON.stringify(receiptBody))
  };
}

module.exports = {
  SCHEMA,
  CHECK_NAMES,
  createCandidateBinding,
  signEvidence,
  verifySignature,
  evaluateHard988
};
