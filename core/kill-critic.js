"use strict";

/**
 * Deterministic safety/evidence gate for proposed repository patches.
 * This module NEVER executes commands and NEVER decides that a patch is safe
 * solely because a model says so.
 */

const CRITICAL_PATHS = [
  /(^|\\/)auth(\\/|$)/i,
  /(^|\\/)crypto(\\/|$)/i,
  /(^|\\/)tls(\\/|$)/i,
  /(^|\\/)acl(\\/|$)/i,
  /(^|\\/)policy(\\/|$)/i,
  /(^|\\/)_test\\.go$/i,
  /(^|\\/)\\.github\\/workflows\\//i,
  /(^|\\/)Dockerfile(?:\\.|$)/i
];

const BLOCKED_PATTERNS = [
  { id:"shell-destructive", re:/\\b(rm\\s+-rf|mkfs(?:\\.\\w+)?|dd\\s+if=|shutdown\\b|reboot\\b)\\b/i },
  { id:"privilege-escalation", re:/\\b(sudo|setcap|chmod\\s+777|chown\\s+-R)\\b/i },
  { id:"secret-exfiltration", re:/(curl|wget|nc|netcat)\\s+[^\\n]*(token|secret|password|api[_-]?key)/i },
  { id:"workflow-code-exec", re:/\\b(pull_request_target|workflow_run)\\b[^\\n]*(run:|shell:)/i },
  { id:"dynamic-eval", re:/\\b(eval|new\\s+Function)\\s*\\(/i }
];

const HIGH_RISK_FILE_PATTERNS = [
  /(^|\\/)\\.github\\/workflows\\//i,
  /(^|\\/)Dockerfile(?:\\.|$)/i,
  /(^|\\/)package(?:-lock)?\\.json$/i
];

function normalizePatch(input) {
  const patch = String(input || "").replace(/\\r\\n/g, "\\n");
  if (!patch.trim()) return { ok:false, files:[], lines:[] };
  const files = [];
  let current = null;
  const lines = patch.split("\\n");
  for (const line of lines) {
    const m = line.match(/^diff --git a\\/(.+) b\\/(.+)$/);
    if (m) {
      current = { path:m[2], additions:0, deletions:0, addedLines:[] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++ b/")) current.path = line.slice(6);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions++;
      current.addedLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions++;
    }
  }
  return { ok:true, files, lines };
}

function isCriticalPath(filePath) {
  return CRITICAL_PATHS.some(re => re.test(filePath));
}

function findFindings(files) {
  const findings = [];
  for (const file of files) {
    const critical = isCriticalPath(file.path);
    const highRisk = HIGH_RISK_FILE_PATTERNS.some(re => re.test(file.path));
    for (const rule of BLOCKED_PATTERNS) {
      for (let i=0; i<file.addedLines.length; i++) {
        if (rule.re.test(file.addedLines[i])) {
          findings.push({
            severity: critical || highRisk ? "block" : "review",
            rule: rule.id,
            path: file.path,
            line: file.addedLines[i]
          });
        }
      }
    }
    if (critical && file.additions > 0) {
      findings.push({
        severity:"review",
        rule:"critical-path-change",
        path:file.path,
        line:null
      });
    }
  }
  return findings;
}

function evaluatePatch({ diff, testsPassed=false, buildPassed=false, proposalId=null } = {}) {
  const parsed = normalizePatch(diff);
  if (!parsed.ok) {
    return {
      decision:"block",
      reason:"empty-or-invalid-diff",
      proposalId,
      evidence:{ files:0, additions:0, deletions:0, testsPassed:!!testsPassed, buildPassed:!!buildPassed }
    };
  }

  const findings = findFindings(parsed.files);
  const hardBlocks = findings.filter(x => x.severity === "block");

  let decision = "review";
  let reason = "manual-review-required";
  if (hardBlocks.length) {
    decision = "block";
    reason = "deterministic-policy-violation";
  } else if (testsPassed && buildPassed && findings.length === 0) {
    decision = "pass";
    reason = "policy-clean-and-verified";
  }

  return {
    decision,
    reason,
    proposalId,
    findings,
    evidence:{
      files:parsed.files.length,
      additions:parsed.files.reduce((n,f)=>n+f.additions,0),
      deletions:parsed.files.reduce((n,f)=>n+f.deletions,0),
      criticalFiles:parsed.files.filter(f=>isCriticalPath(f.path)).map(f=>f.path),
      testsPassed:!!testsPassed,
      buildPassed:!!buildPassed
    }
  };
}

module.exports = { evaluatePatch, normalizePatch, isCriticalPath };
