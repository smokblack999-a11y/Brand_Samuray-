"use strict";

const crypto = require("node:crypto");

const DANGEROUS = [
  { id:"secret_literal", re:/(?:api[_-]?key|token|password|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"']{8,}/i, severity:"critical" },
  { id:"dangerous_shell", re:/(?:child_process|execFile|spawn|system\s*\()|rm\s+-rf|curl\s+[^\n]*\|\s*(?:sh|bash)/i, severity:"high" },
  { id:"workflow_privilege", re:/permissions:\s*|contents:\s*write|pull-requests:\s*write|id-token:\s*write/i, severity:"high" },
  { id:"auth_bypass", re:/(?:skip|disable|bypass)[_-]?(?:auth|authorization|tls|csrf|signature)|verify\s*\(\s*\)\s*\{?\s*return\s+true/i, severity:"critical" },
  { id:"assertion_weakening", re:/(?:assert\.skip|test\.skip|describe\.skip|\.only\s*\(|it\.only\s*\()/i, severity:"high" },
  { id:"destructive_sql", re:/\b(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b/i, severity:"critical" }
];

function parsePatch(diff = "") {
  const lines = String(diff || "").split(/\r?\n/);
  const added = [];
  const deleted = [];
  let file = null;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("--- a/") || line === "--- /dev/null") continue;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) added.push({ file, text: line.slice(1) });
    if (line.startsWith("-") && !line.startsWith("---")) deleted.push({ file, text: line.slice(1) });
  }
  return { added, deleted };
}

function scanLines(lines) {
  const findings = [];
  for (const item of lines) {
    for (const rule of DANGEROUS) {
      if (rule.re.test(item.text)) findings.push({ ...item, rule: rule.id, severity: rule.severity });
    }
  }
  return findings;
}

function analyzeDiff(diff = "") {
  const { added, deleted } = parsePatch(diff);
  const addedFindings = scanLines(added);
  const deletedFindings = scanLines(deleted);
  const findings = [...addedFindings, ...deletedFindings];

  const files = [...new Set([...added, ...deleted].map(x => x.file).filter(Boolean))];
  const deletedAssertions = deleted.filter(x => /\b(?:assert|expect)\b/i.test(x.text)).length;
  const addedAssertions = added.filter(x => /\b(?:assert|expect)\b/i.test(x.text)).length;

  const securityPathTouched = files.filter(f =>
    /(^|\/)(auth|crypto|tls|acl|policy)(\/|$)|\.github\/workflows\/|(^|\/)Dockerfile(?:$|\.)/i.test(f)
  );

  const critical = findings.filter(x => x.severity === "critical");
  const high = findings.filter(x => x.severity === "high");

  const verdict = {
    safe: critical.length === 0 && high.length === 0 && deletedAssertions === 0,
    files,
    addedLines: added.length,
    deletedLines: deleted.length,
    addedFindings,
    deletedFindings,
    criticalCount: critical.length,
    highCount: high.length,
    deletedAssertions,
    addedAssertions,
    securityPathTouched,
    diffHash: crypto.createHash("sha256").update(String(diff)).digest("hex").slice(0, 32)
  };

  if (deletedAssertions > 0) verdict.reasons = ["TEST_ASSERTION_DELETED"];
  else if (critical.length) verdict.reasons = ["CRITICAL_DIFF_PATTERN"];
  else if (high.length) verdict.reasons = ["HIGH_RISK_DIFF_PATTERN"];
  else verdict.reasons = [];

  return verdict;
}

module.exports = { parsePatch, analyzeDiff };
