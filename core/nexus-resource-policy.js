"use strict";

const crypto = require("crypto");

const POLICY_VERSION = "nexus-policy-v3";

const STATES = Object.freeze([
  "UNKNOWN",
  "CI_FAILED",
  "REPAIR_PROPOSED",
  "SANDBOX_PASSED",
  "CI_PASSED",
  "READY_FOR_REVIEW",
  "BLOCKED"
]);

// Deterministic path gates. These are signals, not an automatic vulnerability verdict.
const CRITICAL_RULES = Object.freeze([
  ["authentication", /(?:^|\/)auth(?:\/|$)/i],
  ["cryptography", /(?:^|\/)crypto(?:\/|$)/i],
  ["tls", /(?:^|\/)tls(?:\/|$)/i],
  ["acl", /(?:^|\/)acl(?:\/|$)/i],
  ["policy", /(?:^|\/)policy(?:\/|$)/i],
  ["github_actions", /^\.github\/workflows\//i],
  ["docker", /(?:^|\/)Dockerfile(?:\.|$)/i],
  ["tests", /(?:^|\/)[^/]+\.test\.[^/]+$/i],
  ["tests_convention", /(?:^|\/)[^/]*_test\.[^/]+$/i],
  ["dependencies", /(?:^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|requirements\.txt|poetry\.lock)$/i],
  ["infrastructure", /(?:^|\/)(terraform|k8s|kubernetes|helm|charts)(?:\/|$)/i],
  ["configuration", /(?:^|\/)(config|configs|settings|\.env\.example)(?:\/|$)|(?:^|\/)[^/]*config[^/]*\.(json|ya?ml|toml)$/i],
  ["api_surface", /(?:^|\/)(routes?|controllers?|handlers?|openapi|swagger)(?:\/|$)/i],
  ["database", /(?:^|\/)(migrations?|schema|db)(?:\/|$)|(?:^|\/)[^/]*(migration|schema)[^/]*\.(sql|js|ts)$/i],
  ["large_change", /^__NEXUS_LARGE_CHANGE_SENTINEL__$/i]
]);

const DANGEROUS_PATTERNS = Object.freeze([
  ["recursive_delete", /\brm\s+-rf(?:\s|$)/i],
  ["world_writable", /\bchmod\s+777\b/i],
  ["privileged_container", /\bprivileged\s*:\s*true\b/i],
  ["setuid", /\bset-user-ID\b/i],
  ["privilege_escalation", /\b(?:sudo|su)\s+/i],
  ["workflow_command_injection", /\$\{\{[\s\S]*?\}\}/i],
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  UNKNOWN: ["REPAIR_PROPOSED", "BLOCKED"],
  CI_FAILED: ["REPAIR_PROPOSED", "BLOCKED"],
  REPAIR_PROPOSED: ["SANDBOX_PASSED", "BLOCKED"],
  SANDBOX_PASSED: ["CI_PASSED", "BLOCKED"],
  CI_PASSED: ["READY_FOR_REVIEW", "BLOCKED"],
  READY_FOR_REVIEW: [],
  BLOCKED: []
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeFiles(files) {
  return [...new Set((Array.isArray(files) ? files : [])
    .map(x => String(x).replace(/^\.\//, "").replace(/\\/g, "/").trim())
    .filter(Boolean))];
}

function classifyFiles(files) {
  const normalized = normalizeFiles(files);
  const categories = [];
  for (const [name, re] of CRITICAL_RULES) {
    if (normalized.some(file => re.test(file))) categories.push(name);
  }
  if (normalized.length >= 20 || normalized.some(file => file.length > 180)) categories.push("large_change");

  const criticalSet = new Set([
    "authentication", "cryptography", "tls", "acl", "policy",
    "github_actions", "docker", "dependencies", "infrastructure",
    "configuration", "api_surface", "database", "large_change"
  ]);

  return {
    files: normalized,
    categories: [...new Set(categories)],
    criticalFiles: normalized.filter(file =>
      CRITICAL_RULES.some(([name, re]) => criticalSet.has(name) && re.test(file))
    ),
    criticality: categories.some(category => criticalSet.has(category)) ? "HIGH" : "NORMAL"
  };
}

// Scan only added diff lines. Removed lines must not make a proposed change look dangerous.
function scanDiff(diff) {
  const added = String(diff || "")
    .split("\n")
    .filter(line => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");

  const findings = DANGEROUS_PATTERNS
    .filter(([, re]) => re.test(added))
    .map(([name]) => name);

  if (String(diff || "").includes("${{") && String(diff || "").includes("github.event")) {
    findings.push("workflow_command_injection");
  }
  return {
    addedLines: added,
    findings: [...new Set(findings)],
    dangerous: findings.length > 0
  };
}

function canTransition(from, to) {
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

function evaluate({ resource, fromState, toState, files, diff, actor = "x10think" }) {
  const target = resource || "unknown";
  const classification = classifyFiles(files);
  const scan = scanDiff(diff);
  if (classification.categories.includes("github_actions") && String(diff || "").includes("github.event")) {
    scan.findings.push("workflow_command_injection");
    scan.dangerous = true;
  }
  const reasons = [];
  const required = [];
  let decision = "ALLOW";

  if (!STATES.includes(fromState) || !STATES.includes(toState)) {
    decision = "BLOCK";
    reasons.push("unknown_state");
  } else if (!canTransition(fromState, toState)) {
    decision = "BLOCK";
    reasons.push("invalid_state_transition");
  }

  if (!resource) {
    decision = "BLOCK";
    reasons.push("resource_identity_missing");
  }

  if (scan.dangerous) {
    decision = "BLOCK";
    reasons.push("dangerous_change_pattern");
  }

  if (classification.criticality === "HIGH") {
    required.push("sandbox", "ci", "proof_receipt");
    if (toState === "READY_FOR_REVIEW") required.push("human_review");
  }

  if (fromState === "REPAIR_PROPOSED" && toState === "SANDBOX_PASSED") required.push("sandbox");
  if (fromState === "SANDBOX_PASSED" && toState === "CI_PASSED") required.push("ci");
  if (fromState === "CI_PASSED" && toState === "READY_FOR_REVIEW") required.push("proof_receipt");

  return {
    decision,
    resource: target,
    actor,
    fromState,
    toState,
    criticality: classification.criticality,
    categories: classification.categories,
    changedFiles: classification.files,
    criticalFiles: classification.criticalFiles,
    requiredChecks: [...new Set(required)],
    reasons: [...new Set(reasons)],
    dangerousFindings: scan.findings,
    policyVersion: POLICY_VERSION,
    evaluationHash: sha256(JSON.stringify({
      resource: target,
      fromState,
      toState,
      files: classification.files,
      diff: String(diff || ""),
      actor
    }))
  };
}

function transition(currentState, nextState, context = {}) {
  const evaluation = evaluate({
    ...context,
    fromState: currentState,
    toState: nextState
  });
  return {
    ...evaluation,
    state: evaluation.decision === "ALLOW" ? nextState : "BLOCKED"
  };
}

function createProofReceipt({ evaluation, beforeSha, afterSha, validations = [] }) {
  if (!evaluation || evaluation.decision !== "ALLOW") {
    throw new Error("proof_requires_allowed_transition");
  }

  const receipt = {
    schema: "nexus-proof-receipt/v2",
    resource: evaluation.resource,
    transition: {
      from: evaluation.fromState,
      action: "CONTROLLED_CHANGE",
      to: evaluation.toState
    },
    before: { sha: beforeSha || null },
    after: { sha: afterSha || null },
    policy: evaluation.policyVersion,
    categories: evaluation.categories,
    checks: [...new Set(validations.map(String))],
    criticality: evaluation.criticality,
    evaluationHash: evaluation.evaluationHash
  };

  return {
    ...receipt,
    proofHash: sha256(JSON.stringify(receipt))
  };
}

module.exports = {
  POLICY_VERSION,
  STATES,
  CRITICAL_RULES,
  CRITICAL_PATHS: CRITICAL_RULES.map(([, re]) => re),
  DANGEROUS_PATTERNS,
  ALLOWED_TRANSITIONS,
  normalizeFiles,
  classifyFiles,
  scanDiff,
  canTransition,
  evaluate,
  transition,
  createProofReceipt
};
