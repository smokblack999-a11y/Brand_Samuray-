"use strict";

const crypto = require("node:crypto");
const { canonicalJson, sha256 } = require("./proof-engine");

const REQUIRED = Object.freeze([
  "jobId",
  "repository",
  "headSha",
  "diagnosis",
  "proposal",
  "critic",
  "sandbox",
  "tests",
  "security",
  "policy"
]);

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Proof Receipt requires ${name}`);
  }
}

function requirePass(value, name) {
  if (value !== "PASS") throw new Error(`Proof Receipt requires ${name}=PASS`);
}

function normalizeEvidenceHash(critic) {
  const hash = critic?.evidenceHash;
  if (!/^[a-f0-9]{64}$/i.test(String(hash || ""))) {
    throw new Error("Proof Receipt requires Kill Critic evidenceHash");
  }
  return String(hash).toLowerCase();
}

function normalizeSandbox(sandbox) {
  requireObject(sandbox, "sandbox");
  if (sandbox.passed !== true) throw new Error("Proof Receipt requires sandbox.passed=true");
  const commands = Array.isArray(sandbox.commands) ? sandbox.commands : [];
  if (!commands.length || commands.some((c) => c?.passed !== true || c?.code !== 0)) {
    throw new Error("Proof Receipt requires successful sandbox command evidence");
  }
  return {
    passed: true,
    commands: commands.map((c) => ({
      command: c.command,
      code: c.code,
      signal: c.signal || null,
      timedOut: Boolean(c.timedOut),
      passed: Boolean(c.passed),
      stdout: String(c.stdout || ""),
      stderr: String(c.stderr || "")
    }))
  };
}

function normalizeTests(tests) {
  requireObject(tests, "tests");
  if (tests.passed !== true) throw new Error("Proof Receipt requires tests.passed=true");
  if (Number(tests.failed || 0) !== 0) throw new Error("Proof Receipt requires zero failed tests");
  return {
    passed: true,
    total: Number(tests.total || 0),
    failed: 0,
    command: String(tests.command || "")
  };
}

function createVerifiedProofReceipt(input = {}) {
  for (const key of REQUIRED) {
    if (input[key] == null) throw new Error(`Proof Receipt missing ${key}`);
  }

  requireObject(input.diagnosis, "diagnosis");
  requireObject(input.proposal, "proposal");
  if (input.proposal.status !== "PATCH_CANDIDATE") {
    throw new Error("Proof Receipt requires bounded PATCH_CANDIDATE");
  }

  requireObject(input.critic, "critic");
  if (input.critic.decision !== "PASS") throw new Error("Proof Receipt requires Kill Critic PASS");
  const criticEvidenceHash = normalizeEvidenceHash(input.critic);

  const sandbox = normalizeSandbox(input.sandbox);
  const tests = normalizeTests(input.tests);
  requirePass(input.security, "security");
  requirePass(input.policy, "policy");

  const evidence = {
    diagnosisFingerprint: String(input.diagnosis.fingerprint || ""),
    criticEvidenceHash,
    sandbox,
    tests
  };
  if (!evidence.diagnosisFingerprint) throw new Error("Proof Receipt requires diagnosis fingerprint");

  const receipt = {
    version: 2,
    proofId: `NXS-PROOF-${sha256(canonicalJson({
      jobId: String(input.jobId),
      repository: String(input.repository),
      headSha: String(input.headSha),
      evidence
    })).slice(0, 16)}`,
    jobId: String(input.jobId),
    repository: String(input.repository),
    runId: input.runId == null ? null : Number(input.runId),
    baseSha: String(input.baseSha || ""),
    patchSha: String(input.patchSha || ""),
    headSha: String(input.headSha),
    diagnosis: {
      category: String(input.diagnosis.category || "unknown"),
      confidence: Number(input.diagnosis.confidence || 0),
      fingerprint: evidence.diagnosisFingerprint
    },
    proposal: {
      status: input.proposal.status,
      scope: input.proposal.scope || {}
    },
    critic: {
      decision: "PASS",
      evidenceHash: criticEvidenceHash
    },
    sandbox,
    tests,
    security: "PASS",
    policy: "PASS",
    decision: "SHIP",
    humanRequired: false,
    evidence
  };

  return {
    ...receipt,
    receiptHash: sha256(canonicalJson(receipt))
  };
}

function verifyVerifiedProofReceipt(receipt = {}) {
  if (receipt.version !== 2 || receipt.decision !== "SHIP" || receipt.humanRequired !== false) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(receipt.receiptHash || ""))) return false;
  const unsigned = { ...receipt };
  delete unsigned.receiptHash;
  return sha256(canonicalJson(unsigned)) === receipt.receiptHash;
}

module.exports = { createVerifiedProofReceipt, verifyVerifiedProofReceipt };
