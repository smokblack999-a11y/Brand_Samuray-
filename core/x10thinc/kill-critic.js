"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const DEFAULT_POLICY = Object.freeze({
  criticalPaths: [
    /^\/auth\//i, /^\/crypto\//i, /^\/tls\//i, /^\/acl\//i,
    /^\/policy\//i, /^\/\.github\/workflows\//i, /^\/Dockerfile$/i,
    /(^|\/)security\//i, /(^|\/)secrets?\//i
  ],
  sensitiveExtensions: new Set([".pem", ".key", ".crt", ".p12", ".pfx"]),
  forbiddenSignals: [
    { code: "SECRET_EXPOSURE", re: /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i, severity: "critical" },
    { code: "DANGEROUS_SHELL", re: /(?:rm\s+-rf|curl\s+[^|\n]+\|\s*(?:sh|bash)|chmod\s+777|eval\s*\()/i, severity: "critical" },
    { code: "TLS_VERIFICATION_DISABLED", re: /(?:rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|verify_ssl\s*=\s*false)/i, severity: "critical" },
    { code: "PRIVILEGE_ESCALATION", re: /(?:sudo\s+|setuid\s*\(|runAsUser\s*:\s*0|privileged\s*:\s*true)/i, severity: "critical" }
  ],
  maxChangedFiles: 80,
  maxChangedLines: 2500,
  maxRiskScore: 70,
  criticalRiskScore: 90
});

function normalizePath(file) {
  const p = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return p.startsWith("/") ? p : `/${p}`;
}

function parseUnifiedDiff(diff) {
  const files = [];
  let current = null;
  let added = 0;
  let removed = 0;

  for (const raw of String(diff || "").split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) {
      if (current) files.push(current);
      current = {
        path: normalizePath(raw.slice(6)),
        additions: 0,
        deletions: 0,
        addedText: [],
        removedText: []
      };
      continue;
    }

    if (!current) continue;
    if (raw.startsWith("+++ ") || raw.startsWith("--- ")) continue;

    if (raw.startsWith("+")) {
      current.additions++;
      added++;
      current.addedText.push(raw.slice(1));
    } else if (raw.startsWith("-")) {
      current.deletions++;
      removed++;
      current.removedText.push(raw.slice(1));
    }
  }

  if (current) files.push(current);
  return { files, additions: added, deletions: removed };
}

function isCriticalPath(file, policy = DEFAULT_POLICY) {
  const p = normalizePath(file);
  return policy.criticalPaths.some(re => re.test(p));
}

function collectSignals(text, policy = DEFAULT_POLICY) {
  const signals = [];
  for (const signal of policy.forbiddenSignals) {
    if (signal.re.test(String(text || ""))) {
      signals.push({ code: signal.code, severity: signal.severity });
    }
  }
  return signals;
}

function scoreRisk(parsed, policy = DEFAULT_POLICY) {
  let score = 0;
  const reasons = [];
  const criticalFiles = parsed.files.filter(f => isCriticalPath(f.path, policy));
  const sensitiveFiles = parsed.files.filter(f =>
    policy.sensitiveExtensions.has(path.extname(f.path).toLowerCase())
  );

  if (criticalFiles.length) {
    score += Math.min(35, criticalFiles.length * 12);
    reasons.push("CRITICAL_PATH_CHANGED");
  }

  if (sensitiveFiles.length) {
    score += 35;
    reasons.push("SENSITIVE_FILE_CHANGED");
  }

  if (parsed.files.length > policy.maxChangedFiles) {
    score += 20;
    reasons.push("CHANGESET_TOO_LARGE");
  }

  if (parsed.additions + parsed.deletions > policy.maxChangedLines) {
    score += 20;
    reasons.push("CHANGESET_TOO_LARGE");
  }

  const addedText = parsed.files.flatMap(f => f.addedText);
  const signals = collectSignals(addedText.join("\n"), policy);

  for (const signal of signals) {
    score += signal.severity === "critical" ? 45 : 20;
    reasons.push(signal.code);
  }

  return {
    score: Math.min(100, score),
    reasons: [...new Set(reasons)],
    criticalFiles,
    sensitiveFiles,
    signals
  };
}

function evaluateInvariants({ diff, invariants = [] }) {
  const results = invariants.map(rule => {
    const id = String(rule.id || "anonymous");

    let pattern;
    try {
      pattern = rule.pattern instanceof RegExp
        ? rule.pattern
        : new RegExp(String(rule.pattern || ""), "i");
    } catch {
      return {
        id,
        status: "fail",
        description: rule.description || "Invalid invariant pattern"
      };
    }

    pattern.lastIndex = 0;
    const violated = pattern.test(String(diff || ""));

    return {
      id,
      status: violated ? "fail" : "pass",
      description: rule.description || ""
    };
  });

  return {
    passed: results.every(r => r.status === "pass"),
    results
  };
}

function redactEvidence(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'][^"']+["']/gi, "$1=[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

function decide({
  risk,
  invariantsPassed,
  sandboxPassed,
  testsPassed,
  ciPassed,
  evidenceComplete,
  policy = DEFAULT_POLICY
}) {
  if (!evidenceComplete) return "ESCALATE";
  if (!invariantsPassed) return "KILL";
  if (risk >= policy.criticalRiskScore) return "KILL";
  if (sandboxPassed !== true || testsPassed !== true) return "REJECT";
  if (ciPassed !== true) return "REJECT";
  if (risk >= policy.maxRiskScore) return "ESCALATE";
  return "ALLOW";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function analyzePatch(input = {}, policy = DEFAULT_POLICY) {
  const parsed = parseUnifiedDiff(input.diff || "");
  const risk = scoreRisk(parsed, policy);
  const invariants = evaluateInvariants({
    diff: input.diff || "",
    invariants: input.invariants || []
  });

  const evidenceComplete = Boolean(
    input.evidence &&
    input.evidence.patch &&
    input.evidence.sandbox &&
    input.evidence.tests &&
    input.evidence.ci
  );

  const decision = decide({
    risk: risk.score,
    invariantsPassed: invariants.passed,
    sandboxPassed: input.sandboxPassed,
    testsPassed: input.testsPassed,
    ciPassed: input.ciPassed,
    evidenceComplete,
    policy
  });

  const receipt = {
    version: "x10thinc-proof-v1",
    decision,
    riskScore: risk.score,
    reasons: risk.reasons,
    changedFiles: parsed.files.map(f => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions
    })),
    invariants: invariants.results,
    evidence: {
      patch: redactEvidence(input.evidence?.patch),
      sandbox: redactEvidence(input.evidence?.sandbox),
      tests: redactEvidence(input.evidence?.tests),
      ci: redactEvidence(input.evidence?.ci)
    },
    diffHash: sha256(input.diff || "")
  };

  return { decision, risk, invariants, receipt };
}

module.exports = {
  DEFAULT_POLICY,
  parseUnifiedDiff,
  isCriticalPath,
  collectSignals,
  scoreRisk,
  evaluateInvariants,
  redactEvidence,
  decide,
  analyzePatch,
  sha256
};
