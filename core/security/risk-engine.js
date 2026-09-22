"use strict";

/**
 * X10THINC Data Guard / Kill Critic risk engine.
 *
 * Deterministic, fail-closed analysis of a unified diff.
 * No external services and no secrets are persisted.
 */

const MAX_DIFF_BYTES = 256 * 1024;
const MAX_FILES = 200;
const MAX_REDACTED_CONTEXT = 12000;

const CRITICAL_PATHS = [
  /^auth\//i, /\/auth\//i, /^crypto\//i, /\/crypto\//i,
  /^tls\//i, /\/tls\//i, /^acl\//i, /\/acl\//i,
  /^policy\//i, /\/policy\//i, /\.github\/workflows\//i,
  /(^|\/)Dockerfile$/i, /(^|\/)docker-compose/i, /_test\.[^.]+$/i
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/ig,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\b/i, reason: "recursive-delete" },
  { re: /\bcurl\b[^\n|;&]*\|\s*(?:sh|bash)\b/i, reason: "remote-code-pipe" },
  { re: /\bwget\b[^\n|;&]*\|\s*(?:sh|bash)\b/i, reason: "remote-code-pipe" },
  { re: /child_process\.(?:exec|execFile|spawn|fork)\s*\(/i, reason: "process-execution" },
  { re: /eval\s*\(/i, reason: "dynamic-eval" },
  { re: /(?:chmod|chown)\s+.*(?:777|666)/i, reason: "unsafe-permissions" }
];

const SECURITY_BYPASS_PATTERNS = [
  { re: /verify(?:Signature|Token|Webhook|Auth|Certificate)\s*\([^)]*\)\s*\{?\s*return\s+true\b/i, reason: "verification-bypass" },
  { re: /(?:auth|authentication|authorization|csrf|signature|tls).{0,80}(?:disable|disabled|skip|bypass|false)/i, reason: "security-control-bypass" }
];

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function redactSecrets(text) {
  let out = String(text || "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, match => {
    const prefix = match.slice(0, Math.min(12, match.length));
    return prefix + "[REDACTED]";
  });
  return out;
}

function parseChangedFiles(diff) {
  const files = [];
  for (const line of String(diff).split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) files.push(m[1]);
  }
  return [...new Set(files)].slice(0, MAX_FILES);
}

function addedLines(diff) {
  return String(diff).split("\n")
    .filter(line => line.startsWith("+") && !line.startsWith("+++"))
    .map(line => line.slice(1));
}

function isCriticalPath(file) {
  return CRITICAL_PATHS.some(pattern => pattern.test(file));
}

function analyzeDiff(input = {}) {
  const diff = String(input.diff || "");
  if (!diff) return { decision: "BLOCK", reason: "DIFF_REQUIRED", findings: [] };
  if (byteLength(diff) > MAX_DIFF_BYTES) {
    return { decision: "BLOCK", reason: "DIFF_TOO_LARGE", findings: [] };
  }

  const files = parseChangedFiles(diff);
  const lines = addedLines(diff);
  const findings = [];
  let risk = 0;

  for (const file of files) {
    if (isCriticalPath(file)) {
      risk += 15;
      findings.push({ type: "critical-path", severity: "medium", file });
    }
  }

  for (const line of lines) {
    for (const item of DANGEROUS_PATTERNS) {
      if (item.re.test(line)) {
        risk += 45;
        findings.push({ type: item.reason, severity: "critical", line: redactSecrets(line) });
      }
    }
    for (const item of SECURITY_BYPASS_PATTERNS) {
      if (item.re.test(line)) {
        risk += 50;
        findings.push({ type: item.reason, severity: "critical", line: redactSecrets(line) });
      }
    }
    if (SECRET_PATTERNS.some(pattern => pattern.test(line))) {
      risk += 60;
      findings.push({ type: "secret-exposure", severity: "critical", line: redactSecrets(line) });
    }
  }

  const uniqueFindings = findings.filter((item, index, all) =>
    index === all.findIndex(other =>
      JSON.stringify(other) === JSON.stringify(item)
    )
  );

  const critical = uniqueFindings.some(item => item.severity === "critical");
  const decision = critical || risk >= 60 ? "BLOCK" : risk >= 25 ? "REVIEW" : "ALLOW";

  return {
    version: 1,
    decision,
    risk: Math.min(100, risk),
    files,
    criticalFiles: files.filter(isCriticalPath),
    findings: uniqueFindings.slice(0, 100),
    evidence: {
      changedFiles: files.length,
      addedLines: lines.length,
      redactedContext: redactSecrets(lines.join("\n")).slice(0, MAX_REDACTED_CONTEXT)
    }
  };
}

module.exports = {
  MAX_DIFF_BYTES,
  analyzeDiff,
  redactSecrets,
  parseChangedFiles
};
