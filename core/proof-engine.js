"use strict";

const crypto = require("crypto");

const STATES = Object.freeze([
  "RECEIVED", "TRIAGED", "DIAGNOSED", "PATCHING", "SANDBOX",
  "TESTING", "CRITIC", "SECURITY", "POLICY", "PROOF", "SHIP",
  "FAILED", "BLOCKED", "KILLED", "ROLLED_BACK", "HUMAN_REVIEW"
]);

const TERMINAL = new Set(["SHIP", "FAILED", "BLOCKED", "KILLED", "ROLLED_BACK", "HUMAN_REVIEW"]);

const TRANSITIONS = Object.freeze({
  RECEIVED: ["TRIAGED", "FAILED", "KILLED"],
  TRIAGED: ["DIAGNOSED", "FAILED", "KILLED", "HUMAN_REVIEW"],
  DIAGNOSED: ["PATCHING", "FAILED", "KILLED", "HUMAN_REVIEW"],
  PATCHING: ["SANDBOX", "FAILED", "KILLED", "HUMAN_REVIEW"],
  SANDBOX: ["TESTING", "FAILED", "KILLED", "HUMAN_REVIEW"],
  TESTING: ["CRITIC", "FAILED", "KILLED", "HUMAN_REVIEW"],
  CRITIC: ["SECURITY", "BLOCKED", "FAILED", "KILLED", "HUMAN_REVIEW"],
  SECURITY: ["POLICY", "BLOCKED", "FAILED", "KILLED", "HUMAN_REVIEW"],
  POLICY: ["PROOF", "BLOCKED", "FAILED", "KILLED", "HUMAN_REVIEW"],
  PROOF: ["SHIP", "BLOCKED", "FAILED", "HUMAN_REVIEW"],
  SHIP: [], FAILED: [], BLOCKED: [], KILLED: [], ROLLED_BACK: [], HUMAN_REVIEW: []
});

const RISK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonicalize(value[key]);
    return out;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function createJob(input = {}) {
  const now = input.createdAt || new Date().toISOString();
  return {
    jobId: input.jobId || crypto.randomUUID(),
    repository: String(input.repository || ""),
    baseSha: String(input.baseSha || ""),
    patchSha: String(input.patchSha || ""),
    state: "RECEIVED",
    risk: normalizeRisk(input.risk),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    killed: false
  };
}

function normalizeRisk(value) {
  const risk = String(value || "LOW").toUpperCase();
  return Object.prototype.hasOwnProperty.call(RISK, risk) ? risk : "HIGH";
}

function canTransition(from, to) {
  return STATES.includes(from) && STATES.includes(to) && TRANSITIONS[from].includes(to);
}

function transition(job, nextState, metadata = {}) {
  if (!job || !canTransition(job.state, nextState)) {
    throw new Error(`Invalid NEXUS transition: ${job?.state || "UNKNOWN"} -> ${nextState}`);
  }
  const now = metadata.timestamp || new Date().toISOString();
  return {
    ...job,
    state: nextState,
    updatedAt: now,
    ...(metadata.attempt != null ? { attempts: Number(metadata.attempt) } : {})
  };
}

function kill(job, reason = "manual kill") {
  const next = transition(job, "KILLED");
  return { ...next, killed: true, killReason: String(reason), updatedAt: new Date().toISOString() };
}

function evidencePass(evidence = {}) {
  return Boolean(
    evidence.command &&
    Number.isInteger(evidence.exitCode) &&
    evidence.exitCode === 0 &&
    evidence.logHash &&
    evidence.commitSha
  );
}

function criticPass(critic = {}) {
  const required = ["correctness", "regression", "security", "scope"];
  return required.every((key) => critic[key] === "PASS");
}

function evaluateGate({ risk = "LOW", evidence = [], critic = {}, security = "PASS", policy = "PASS" } = {}) {
  const normalizedRisk = normalizeRisk(risk);
  const evidenceOk = Array.isArray(evidence) && evidence.length > 0 && evidence.every(evidencePass);
  const criticOk = criticPass(critic);
  const securityOk = security === "PASS";
  const policyOk = policy === "PASS";
  const humanRequired = RISK[normalizedRisk] >= RISK.HIGH;
  const approved = evidenceOk && criticOk && securityOk && policyOk && !humanRequired;

  return {
    approved,
    decision: approved ? "SHIP" : humanRequired ? "HUMAN_REVIEW" : "BLOCKED",
    risk: normalizedRisk,
    checks: { evidence: evidenceOk, critic: criticOk, security: securityOk, policy: policyOk },
    humanRequired
  };
}

function createProofReceipt({ job, evidence = [], critic = {}, security = "PASS", policy = "PASS", tests = {} } = {}) {
  if (!job) throw new Error("job is required");
  const gate = evaluateGate({ risk: job.risk, evidence, critic, security, policy });
  const receipt = {
    version: 1,
    proofId: `NXS-${crypto.randomUUID()}`,
    jobId: job.jobId,
    repository: job.repository,
    baseSha: job.baseSha,
    patchSha: job.patchSha,
    risk: gate.risk,
    tests,
    security,
    critic,
    policy,
    evidence,
    decision: gate.decision,
    humanRequired: gate.humanRequired,
    createdAt: new Date().toISOString()
  };
  const unsigned = canonicalJson(receipt);
  return {
    ...receipt,
    receiptHash: sha256(unsigned)
  };
}

module.exports = {
  STATES,
  TRANSITIONS,
  createJob,
  canTransition,
  transition,
  kill,
  evidencePass,
  criticPass,
  evaluateGate,
  createProofReceipt,
  canonicalJson,
  sha256
};
