"use strict";

const crypto = require("node:crypto");

const RULES = [
  ["empty_output", value => !value.trim()],
  ["oversized_output", value => value.length > 50000],
  ["script_tag", value => /<\\s*script\\b/i.test(value)],
  ["javascript_url", value => /javascript\\s*:/i.test(value)],
  ["inline_event_handler", value => /\\bon[a-z]+\\s*=\\s*["']/i.test(value)],
  ["credential_pattern", value => /(?:sk-(?:live|test|proj)-[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/.test(value)]
];

function reviewCandidate({ task, candidate, evidence = [], proposedActions = [] }) {
  const output = String(candidate ?? "");
  const issues = RULES.filter(([, predicate]) => predicate(output)).map(([name]) => name);
  const evidenceIds = new Set(evidence.map(item => item && item.id).filter(Boolean));
  const unsupportedActions = proposedActions.filter(action => !action || !action.evidenceId || !evidenceIds.has(action.evidenceId));
  if (unsupportedActions.length) issues.push("action_without_evidence");
  if (!String(task || "").trim()) issues.push("task_missing");
  return {
    verdict: issues.length ? "FAIL" : "PASS",
    issues,
    evidenceGaps: unsupportedActions.length ? ["Every proposed action must reference an evidence item."] : [],
    fingerprint: crypto.createHash("sha256").update(String(task || "") + "\n" + output).digest("hex"),
    checkedAt: new Date().toISOString(),
    source: "deterministic-local-checks"
  };
}
module.exports = { reviewCandidate };
