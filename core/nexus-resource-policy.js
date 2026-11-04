"use strict";

const crypto = require("crypto");

const STATES = Object.freeze([
  "UNKNOWN", "CI_FAILED", "REPAIR_PROPOSED", "SANDBOX_PASSED",
  "CI_PASSED", "READY_FOR_REVIEW", "BLOCKED"
]);

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
  ["workflow_command_injection", /\$\{\{[\s\S]*?\}\}/i]
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
    "authentication", "cryptography", "tls", "acl", "policy", "github_actions",
    "docker", "dependencies", "infrastructure", "configuration", "api_surface",
    "database", "large_change"
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

function scanDiff(diff) {
  const added = String(diff || "").split("\n")
    .filter(line => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  const findings = DANGEROUS_PATTERNS
    .filter(([, re]) => re.test(added))
    .map(([name]) => name);
  if (String(diff || "").includes("${{") && String(diff || "").includes("github.event")) {
    findings.push("workflow_command_injection");
  }
  return { addedLines: added, findings: [...new Set(findings)], dangerous: findings.length > 0 };
}

function canTransition(from, to) {
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

function checksRequiredFor(toState) {
  if (toState === "SANDBOX_PASSED") return ["sandbox"];
  if (toState === "CI_PASSED") return ["sandbox", "ci"];
  if (toState === "READY_FOR_REVIEW") return ["sandbox", "ci", "proof_receipt"];
  return [];
}

function verifyProofReceipt(receipt, resource) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const { proofHash, ...payload } = receipt;
  if (receipt.schema !== "nexus-proof-receipt/v3" || receipt.resource !== resource) return false;
  if (!receipt.before?.sha || !receipt.after?.sha) return false;
  if (!Array.isArray(receipt.checks) || !receipt.checks.includes("sandbox") || !receipt.checks.includes("ci")) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(receipt.evaluationHash || ""))) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(proofHash || ""))) return false;
  return sha256(JSON.stringify(payload)) === proofHash;
}

function evaluate({ resource, fromState, toState, files, diff, actor = "x10think", evidence = {} }) {
  const target = resource || "unknown";
  const classification = classifyFiles(files);
  const scan = scanDiff(diff);
  if (classification.categories.includes("github_actions") && String(diff || "").includes("github.event")) {
    scan.findings.push("workflow_command_injection");
    scan.dangerous = true;
  }

  const reasons = [];
  const required = checksRequiredFor(toState);
  const suppliedChecks = new Set(Array.isArray(evidence.checks) ? evidence.checks.map(String) : []);
  const missingEvidence = required.filter(check => !suppliedChecks.has(check));
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
  if (missingEvidence.length) {
    decision = "BLOCK";
    reasons.push("required_evidence_missing");
  }
  if (required.includes("proof_receipt") && !verifyProofReceipt(evidence.proofReceipt, target)) {
    decision = "BLOCK";
    reasons.push("valid_proof_receipt_required");
  }

  const advisoryChecks = classification.criticality === "HIGH"
    ? ["sandbox", "ci", "proof_receipt", ...(toState === "READY_FOR_REVIEW" ? ["human_review"] : [])]
    : required;

  const evaluationHash = sha256(JSON.stringify({
    resource: target, fromState, toState, files: classification.files,
    diff: String(diff || ""), actor, checks: [...suppliedChecks].sort(),
    proofReceiptHash: evidence.proofReceipt?.proofHash || null
  }));

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
    requiredChecks: [...new Set(advisoryChecks)],
    suppliedChecks: [...suppliedChecks].sort(),
    missingEvidence,
    reasons: [...new Set(reasons)],
    dangerousFindings: scan.findings,
    policyVersion: "nexus-policy-v4-evidence-enforced",
    evaluationHash
  };
}

function transition(currentState, nextState, context = {}) {
  const evaluation = evaluate({ ...context, fromState: currentState, toState: nextState });
  return {
    ...evaluation,
    state: evaluation.decision === "ALLOW" ? nextState : "BLOCKED"
  };
}

function createProofReceipt({ evaluation, beforeSha, afterSha, validations = [] }) {
  if (!evaluation || evaluation.decision !== "ALLOW") {
    throw new Error("proof_requires_allowed_transition");
  }
  const checks = [...new Set(validations.map(String))];
  if (evaluation.criticality === "HIGH" &&
      (!checks.includes("sandbox") || !checks.includes("ci"))) {
    throw new Error("critical_proof_requires_sandbox_and_ci");
  }
  if (evaluation.criticality === "HIGH" && (!beforeSha || !afterSha)) {
    throw new Error("critical_proof_requires_before_after_sha");
  }
  const receipt = {
    schema: "nexus-proof-receipt/v3",
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
    checks,
    criticality: evaluation.criticality,
    evaluationHash: evaluation.evaluationHash
  };
  return { ...receipt, proofHash: sha256(JSON.stringify(receipt)) };
}

module.exports = {
  STATES, CRITICAL_RULES, CRITICAL_PATHS: CRITICAL_RULES.map(([, re]) => re),
  DANGEROUS_PATTERNS, ALLOWED_TRANSITIONS, normalizeFiles, classifyFiles,
  scanDiff, canTransition, checksRequiredFor, verifyProofReceipt, evaluate, transition, createProofReceipt
};
