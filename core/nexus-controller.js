"use strict";

const { createJob, transition, createProofReceipt, sha256 } = require("./proof-engine");
const { enforcePolicy } = require("./nexus-policy");

function runVerification(input = {}) {
  let job = createJob({
    jobId: input.jobId,
    repository: input.repository,
    baseSha: input.baseSha,
    patchSha: input.patchSha,
    risk: input.risk
  });

  const states = ["TRIAGED", "DIAGNOSED", "PATCHING", "SANDBOX", "TESTING", "CRITIC", "SECURITY", "POLICY"];
  for (const state of states) job = transition(job, state);

  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const critic = input.critic || {};
  const policy = enforcePolicy({
    changedFiles: input.changedFiles || [],
    labels: input.labels || [],
    risk: input.risk,
    evidence,
    critic,
    security: input.security || "UNKNOWN",
    policy: input.policy || "PASS"
  });

  const receipt = createProofReceipt({
    job,
    evidence,
    critic,
    security: input.security || "UNKNOWN",
    policy: policy.policy === "HUMAN_REQUIRED" ? "HUMAN_REQUIRED" : (input.policy || "PASS"),
    tests: input.tests || {}
  });

  return { job, policy, receipt };
}

function buildEvidence({ command, exitCode, log, commitSha }) {
  return {
    command: String(command || ""),
    exitCode: Number(exitCode),
    logHash: sha256(String(log || "")),
    commitSha: String(commitSha || "")
  };
}

module.exports = { runVerification, buildEvidence };
