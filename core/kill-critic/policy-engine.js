"use strict";

const crypto = require("node:crypto");

const STATES = Object.freeze([
  "NORMAL",
  "SUSPICIOUS",
  "HIGH_RISK",
  "CRITICAL",
  "QUARANTINED",
  "VERIFIED",
  "BLOCKED"
]);

const DECISIONS = Object.freeze(["ALLOW", "ESCALATE", "QUARANTINE", "BLOCK"]);

const RULES = Object.freeze([
  { id: "SECURITY_PATH", level: "HIGH_RISK", paths: [/^auth\//, /^crypto\//, /^tls\//, /^acl\//, /^policy\//] },
  { id: "WORKFLOW_CONTROL", level: "HIGH_RISK", paths: [/^\.github\/workflows\//, /^Dockerfile(?:\.|$)/] },
  { id: "TEST_CHANGE", level: "SUSPICIOUS", paths: [/(^|\/)__tests__\//, /\.test\.[^/]+$/, /_test\.[^/]+$/] },
  { id: "DESTRUCTIVE_NAME", level: "CRITICAL", paths: [/(^|\/)rm-rf\//, /(^|\/)destroy\//] }
]);

const RANK = Object.freeze({ NORMAL: 0, SUSPICIOUS: 1, HIGH_RISK: 2, CRITICAL: 3, QUARANTINED: 4, VERIFIED: 5, BLOCKED: 5 });

function normalizePath(path) {
  return String(path || "").replace(/^\.\//, "").replace(/\\/g, "/");
}

function classifyFiles(files) {
  const normalized = [...new Set((Array.isArray(files) ? files : []).map(normalizePath).filter(Boolean))];
  const findings = [];

  for (const file of normalized) {
    for (const rule of RULES) {
      if (rule.paths.some(re => re.test(file))) {
        findings.push({ rule: rule.id, level: rule.level, file });
      }
    }
  }

  return {
    files: normalized,
    findings,
    highestRisk: findings.reduce(
      (highest, finding) => RANK[finding.level] > RANK[highest] ? finding.level : highest,
      "NORMAL"
    )
  };
}

function decide(input = {}) {
  const analysis = classifyFiles(input.files);
  const testsPassed = input.testsPassed === true;
  const sandboxPassed = input.sandboxPassed === true;
  const ciPassed = input.ciPassed === true;
  const hasEvidence = input.reproduction === true && input.causality === true;
  const hasPatch = Boolean(String(input.diff || "").trim());

  if (!hasPatch) return { state: "BLOCKED", decision: "BLOCK", reason: "PATCH_REQUIRED", ...analysis };

  if (analysis.highestRisk === "CRITICAL") {
    return { state: "QUARANTINED", decision: "QUARANTINE", reason: "CRITICAL_PATH_OR_DESTRUCTIVE_CHANGE", ...analysis };
  }

  if (!hasEvidence) {
    return { state: "SUSPICIOUS", decision: "ESCALATE", reason: "REPRODUCTION_AND_CAUSALITY_REQUIRED", ...analysis };
  }

  if (analysis.highestRisk === "HIGH_RISK" && !sandboxPassed) {
    return { state: "QUARANTINED", decision: "QUARANTINE", reason: "SANDBOX_REQUIRED_FOR_HIGH_RISK", ...analysis };
  }

  if (!testsPassed) {
    return { state: "HIGH_RISK", decision: "ESCALATE", reason: "TEST_PROOF_REQUIRED", ...analysis };
  }

  if (!ciPassed) {
    return { state: "HIGH_RISK", decision: "ESCALATE", reason: "POST_REPAIR_CI_REQUIRED", ...analysis };
  }

  return { state: "VERIFIED", decision: "ALLOW", reason: "EVIDENCE_SANDBOX_TESTS_AND_CI_PASSED", ...analysis };
}

function createDecisionRecord(input = {}) {
  const decision = decide(input);
  const record = {
    version: 1,
    jobId: String(input.jobId || "unknown"),
    sourceSha: String(input.sourceSha || ""),
    diffSha256: crypto.createHash("sha256").update(String(input.diff || ""), "utf8").digest("hex"),
    policyVersion: String(input.policyVersion || "kc-policy-1"),
    decision: decision.decision,
    state: decision.state,
    reason: decision.reason,
    findings: decision.findings,
    evidence: {
      reproduction: input.reproduction === true,
      causality: input.causality === true,
      sandbox: input.sandboxPassed === true,
      tests: input.testsPassed === true,
      ci: input.ciPassed === true
    }
  };

  const canonical = JSON.stringify(record);
  return {
    ...record,
    decisionHash: crypto.createHash("sha256").update(canonical, "utf8").digest("hex")
  };
}

module.exports = {
  STATES,
  DECISIONS,
  classifyFiles,
  decide,
  createDecisionRecord
};
