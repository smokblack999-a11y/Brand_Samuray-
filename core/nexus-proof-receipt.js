"use strict";

const crypto = require("node:crypto");

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

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} is required`);
  }
}

function createVerifiedProofReceipt({
  job,
  diagnosis,
  proposal,
  critic,
  sandbox,
  tests,
  security = "PASS",
  policy = "PASS"
} = {}) {
  assertObject(job, "job");
  assertObject(diagnosis, "diagnosis");
  assertObject(proposal, "proposal");
  assertObject(critic, "critic");
  assertObject(sandbox, "sandbox");
  assertObject(tests, "tests");

  if (!job.jobId || !job.repository || !job.baseSha || !job.patchSha) {
    throw new Error("job identity evidence is incomplete");
  }
  if (!diagnosis.fingerprint || !diagnosis.category) {
    throw new Error("diagnosis evidence is incomplete");
  }
  if (proposal.status !== "PATCH_CANDIDATE") {
    throw new Error("proof requires a bounded patch proposal");
  }
  if (critic.decision !== "PASS" || !critic.evidenceHash) {
    throw new Error("proof requires Kill Critic PASS evidence");
  }
  if (sandbox.decision !== "PASS" || !sandbox.sandbox?.passed) {
    throw new Error("proof requires sandbox PASS evidence");
  }
  if (tests.passed !== true && !(Number.isInteger(tests.failed) && tests.failed === 0)) {
    throw new Error("proof requires passing test evidence");
  }
  if (security !== "PASS") throw new Error("proof requires security PASS");
  if (policy !== "PASS") throw new Error("proof requires policy PASS");
  if (String(job.risk || "LOW").toUpperCase() !== "LOW") {
    throw new Error("proof-to-ship receipt requires LOW risk; higher risk requires human review");
  }

  const evidence = {
    diagnosis: {
      category: diagnosis.category,
      confidence: Number(diagnosis.confidence),
      fingerprint: diagnosis.fingerprint
    },
    proposal: {
      status: proposal.status,
      scope: proposal.scope || null,
      intent: proposal.intent || ""
    },
    critic: {
      decision: critic.decision,
      evidenceHash: critic.evidenceHash,
      failures: critic.failures || []
    },
    sandbox: {
      decision: sandbox.decision,
      passed: sandbox.sandbox.passed,
      commands: sandbox.sandbox.commands || []
    },
    tests,
    security,
    policy
  };

  const proofSeed = {
    version: 1,
    jobId: job.jobId,
    repository: job.repository,
    baseSha: job.baseSha,
    patchSha: job.patchSha,
    risk: "LOW",
    evidence
  };
  const proofHash = sha256(canonicalJson(proofSeed));

  const receipt = {
    ...proofSeed,
    proofId: `NXS-${proofHash.slice(0, 24)}`,
    decision: "SHIP",
    humanRequired: false
  };

  return {
    ...receipt,
    receiptHash: sha256(canonicalJson(receipt))
  };
}

module.exports = { createVerifiedProofReceipt, canonicalJson, sha256 };
