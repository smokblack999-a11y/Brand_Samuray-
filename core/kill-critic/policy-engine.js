"use strict";

/**
 * Kill Critic Policy Engine
 * Context-aware enforcement for code changes.
 *
 * Decision states:
 * ALLOW      - safe enough for normal execution
 * REVIEW     - requires human review
 * QUARANTINE - sandbox-only; no push/merge
 * BLOCK      - execution must stop
 */

const crypto = require("crypto");

const DEFAULT_RULES = Object.freeze({
  criticalPaths: [
    /(^|\/)auth(entication|orization)?(\/|$)/i,
    /(^|\/)crypto(\/|$)/i,
    /(^|\/)tls(\/|$)/i,
    /(^|\/)acl(\/|$)/i,
    /(^|\/)policy(\/|$)/i,
    /(^|\/)\.github\/workflows(\/|$)/i,
    /(^|\/)Dockerfile$/i,
    /_test\.(go|ts|tsx|js|jsx|py)$/i,
  ],
  dangerousPatterns: [
    { id: "shell-delete", re: /\brm\s+-rf\b/i, weight: 100 },
    { id: "credential-exfil", re: /(curl|wget|fetch|axios)[^\n]*(token|secret|password|api[_-]?key)/i, weight: 100 },
    { id: "workflow-permission-write", re: /permissions:[\s\S]{0,200}\b(write-all|contents:\s*write)\b/i, weight: 80 },
    { id: "disable-verification", re: /(skip|disable|turn.?off).{0,40}(verify|verification|tls|ssl|signature)/i, weight: 80 },
    { id: "hardcoded-secret", re: /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)/, weight: 100 },
    { id: "dynamic-code-exec", re: /\b(eval|new Function)\s*\(/i, weight: 70 },
  ],
});

function normalizeDiff(diff) {
  return String(diff || "").replace(/\r\n/g, "\n");
}

function extractChangedFiles(diff) {
  const files = [];
  const seen = new Set();
  const re = /^\+\+\+ b\/(.+)$/gm;
  let match;
  while ((match = re.exec(diff))) {
    const file = match[1].trim();
    if (file !== "/dev/null" && !seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

function addedLines(diff) {
  return diff.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
}

function scoreDiff(diff, rules = DEFAULT_RULES) {
  const normalized = normalizeDiff(diff);
  const files = extractChangedFiles(normalized);
  const added = addedLines(normalized);
  const findings = [];
  let score = 0;

  for (const file of files) {
    for (const rule of rules.criticalPaths) {
      if (rule.test(file)) {
        findings.push({
          id: "critical-path",
          path: file,
          severity: "high",
          reason: "critical path modified",
        });
        score += 25;
        break;
      }
    }
  }

  for (const rule of rules.dangerousPatterns) {
    if (rule.re.test(added)) {
      findings.push({
        id: rule.id,
        severity: rule.weight >= 100 ? "critical" : "high",
        reason: "dangerous pattern detected in added lines",
      });
      score += rule.weight;
    }
  }

  const largeDiff = added.split("\n").filter(Boolean).length > 500;
  if (largeDiff) {
    findings.push({
      id: "large-change",
      severity: "medium",
      reason: "more than 500 added lines",
    });
    score += 15;
  }

  const uniqueIds = [...new Set(findings.map((x) => x.id))];
  const cappedScore = Math.min(score, 100);

  let decision = "ALLOW";
  if (cappedScore >= 100 || findings.some((x) => x.severity === "critical")) {
    decision = "BLOCK";
  } else if (cappedScore >= 50) {
    decision = "QUARANTINE";
  } else if (cappedScore >= 25) {
    decision = "REVIEW";
  }

  return {
    decision,
    riskScore: cappedScore,
    changedFiles: files,
    findingCount: uniqueIds.length,
    findings,
    policyVersion: "kc-policy-1.0.0",
  };
}

function evaluate(input = {}) {
  const result = scoreDiff(input.diff || "");
  const now = new Date().toISOString();
  const payload = {
    policyVersion: result.policyVersion,
    decision: result.decision,
    riskScore: result.riskScore,
    changedFiles: result.changedFiles,
    findings: result.findings,
    jobId: input.jobId ? String(input.jobId) : null,
    commit: input.commit ? String(input.commit) : null,
    timestamp: now,
  };

  const decisionHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return Object.freeze({ ...payload, decisionHash });
}

module.exports = {
  DEFAULT_RULES,
  extractChangedFiles,
  scoreDiff,
  evaluate,
};
