"use strict";

const crypto = require("node:crypto");

const STATES = Object.freeze([
  "UNKNOWN",
  "CI_FAILED",
  "AI_PATCH_PROPOSED",
  "CRITIC_FAILED",
  "CRITIC_PASSED",
  "SANDBOX_FAILED",
  "SANDBOX_PASSED",
  "CI_PASSED",
  "READY_FOR_REVIEW",
  "DEPLOYED",
  "BLOCKED"
]);

const TERMINAL = new Set(["BLOCKED", "DEPLOYED"]);

const TRANSITIONS = Object.freeze({
  UNKNOWN: new Set(["AI_PATCH_PROPOSED", "BLOCKED"]),
  CI_FAILED: new Set(["AI_PATCH_PROPOSED", "BLOCKED"]),
  AI_PATCH_PROPOSED: new Set(["CRITIC_FAILED", "CRITIC_PASSED", "BLOCKED"]),
  CRITIC_FAILED: new Set(["AI_PATCH_PROPOSED", "BLOCKED"]),
  CRITIC_PASSED: new Set(["SANDBOX_FAILED", "SANDBOX_PASSED", "BLOCKED"]),
  SANDBOX_FAILED: new Set(["AI_PATCH_PROPOSED", "BLOCKED"]),
  SANDBOX_PASSED: new Set(["CI_FAILED", "CI_PASSED", "BLOCKED"]),
  CI_PASSED: new Set(["READY_FOR_REVIEW", "BLOCKED"]),
  READY_FOR_REVIEW: new Set(["DEPLOYED", "BLOCKED"]),
  DEPLOYED: new Set(),
  BLOCKED: new Set()
});

const CRITICAL_RULES = Object.freeze([
  { id: "auth", re: /(^|\/)auth(\/|$)/i, controls: ["sandbox", "security_review"] },
  { id: "crypto", re: /(^|\/)crypto(\/|$)/i, controls: ["sandbox", "security_review"] },
  { id: "tls", re: /(^|\/)tls(\/|$)/i, controls: ["sandbox", "security_review"] },
  { id: "acl", re: /(^|\/)acl(\/|$)/i, controls: ["sandbox", "security_review"] },
  { id: "policy", re: /(^|\/)policy(\/|$)/i, controls: ["sandbox", "security_review"] },
  { id: "workflow", re: /(^|\.)github\/workflows\//i, controls: ["sandbox", "ci_review"] },
  { id: "dockerfile", re: /(^|\/)Dockerfile$/i, controls: ["sandbox", "container_review"] },
  { id: "tests", re: /_test\.[^/]+$/i, controls: ["ci_review"] }
]);

function normalizePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map(String).map(p => p.replace(/^\.\//, "").trim()).filter(Boolean))];
}

function classifyChange(paths) {
  const normalized = normalizePaths(paths);
  const matches = [];
  const controls = new Set();

  for (const path of normalized) {
    for (const rule of CRITICAL_RULES) {
      if (rule.re.test(path)) {
        matches.push({ path, rule: rule.id });
        for (const control of rule.controls) controls.add(control);
      }
    }
  }

  return {
    paths: normalized,
    critical: matches.length > 0,
    matches,
    controls: [...controls].sort()
  };
}

function evaluatePolicy({ paths, actor = "unknown", action = "repair", evidence = {} } = {}) {
  const classification = classifyChange(paths);
  const reasons = [];

  if (!classification.paths.length) reasons.push("no_changed_paths");
  if (action !== "repair") reasons.push("unsupported_action");
  if (actor === "unknown") reasons.push("unknown_actor");

  const required = new Set(classification.controls);
  if (classification.critical) required.add("proof_receipt");
  if (classification.critical) required.add("human_review");

  const evidenceMap = evidence && typeof evidence === "object" ? evidence : {};
  for (const control of required) {
    if (control !== "human_review" && control !== "proof_receipt" && evidenceMap[control] !== true) {
      reasons.push("missing_" + control);
    }
  }

  const blocked = reasons.some(r => r === "no_changed_paths" || r === "unsupported_action" || r === "unknown_actor");
  const allowed = !blocked && reasons.filter(r => r.startsWith("missing_")).length === 0;

  return {
    decision: allowed ? "ALLOW" : "BLOCK",
    fail_closed: true,
    critical: classification.critical,
    classification,
    required_controls: [...required].sort(),
    reasons
  };
}

function transition(current, next) {
  const from = String(current || "UNKNOWN");
  const to = String(next || "");
  if (!STATES.includes(from) || !STATES.includes(to)) {
    throw new Error("invalid_state");
  }
  if (!TRANSITIONS[from].has(to)) {
    throw new Error(`invalid_transition:${from}->${to}`);
  }
  return { from, to, terminal: TERMINAL.has(to) };
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function createProofReceipt(input = {}) {
  const required = ["resource_id", "from_state", "to_state", "action", "head_sha"];
  for (const key of required) {
    if (!input[key]) throw new Error("missing_proof_field:" + key);
  }

  const body = {
    version: 2,
    resource_id: String(input.resource_id),
    transition: transition(input.from_state, input.to_state),
    action: String(input.action),
    head_sha: String(input.head_sha),
    policy_id: String(input.policy_id || "nexus-default-v1"),
    validation: input.validation && typeof input.validation === "object" ? input.validation : {},
    created_at: String(input.created_at || new Date().toISOString())
  };

  body.proof_hash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return Object.freeze(body);
}

module.exports = {
  STATES,
  TRANSITIONS,
  CRITICAL_RULES,
  normalizePaths,
  classifyChange,
  evaluatePolicy,
  transition,
  createProofReceipt
};
