"use strict";

/**
 * NEXUS Resource Control Plane
 *
 * Core invariant:
 *   INTENT -> RESOURCE -> STATE -> POLICY -> ACTION -> VALIDATION -> PROOF
 *
 * Fail-closed by default. This module is deterministic and has no network,
 * shell, GitHub, or credential access. Adapters execute approved actions.
 */

const STATES = Object.freeze([
  "UNKNOWN",
  "CI_FAILED",
  "AI_PATCH_PROPOSED",
  "SANDBOX_RUNNING",
  "SANDBOX_PASSED",
  "SANDBOX_FAILED",
  "CI_RUNNING",
  "CI_PASSED",
  "CI_FAILED_AFTER_REPAIR",
  "READY_FOR_REVIEW",
  "BLOCKED",
  "DEPLOYED"
]);

const ACTIONS = Object.freeze([
  "OBSERVE",
  "PROPOSE_PATCH",
  "RUN_SANDBOX",
  "RUN_CI",
  "REQUEST_REVIEW",
  "DEPLOY"
]);

const DEFAULT_POLICY = Object.freeze({
  requireSandboxForCritical: true,
  requireCiForCodeChanges: true,
  requireReviewForCritical: true,
  denyDeployFromFailedStates: true
});

function normalizeResource(resource) {
  if (!resource || typeof resource !== "object") {
    throw new TypeError("resource must be an object");
  }
  if (!resource.id || typeof resource.id !== "string") {
    throw new TypeError("resource.id is required");
  }
  return Object.freeze({
    id: resource.id,
    type: resource.type || "unknown",
    criticality: resource.criticality || "normal",
    owner: resource.owner || null
  });
}

function normalizeState(state) {
  if (!STATES.includes(state)) throw new Error("unknown state: " + state);
  return state;
}

function evaluateTransition(from, action, to) {
  normalizeState(from);
  normalizeState(to);
  if (!ACTIONS.includes(action)) throw new Error("unknown action: " + action);

  const allowed = {
    "CI_FAILED": { PROPOSE_PATCH: "AI_PATCH_PROPOSED" },
    "AI_PATCH_PROPOSED": { RUN_SANDBOX: "SANDBOX_RUNNING" },
    "SANDBOX_RUNNING": {
      RUN_CI: "CI_RUNNING"
    },
    "SANDBOX_PASSED": { RUN_CI: "CI_RUNNING" },
    "CI_RUNNING": {
      OBSERVE: "CI_PASSED"
    },
    "CI_PASSED": { REQUEST_REVIEW: "READY_FOR_REVIEW" },
    "READY_FOR_REVIEW": { DEPLOY: "DEPLOYED" }
  };

  return allowed[from] && allowed[from][action] === to;
}

function inspectChange(change) {
  const files = Array.isArray(change && change.files) ? change.files : [];
  const criticalPatterns = [
    /(^|\/)auth(\/|$)/i,
    /(^|\/)crypto(\/|$)/i,
    /(^|\/)tls(\/|$)/i,
    /(^|\/)acl(\/|$)/i,
    /(^|\/)policy(\/|$)/i,
    /(^|\.)github\/workflows\//i,
    /(^|\/)dockerfile$/i,
    /_test\.(go|js|ts|py|rs|java)$/i
  ];

  const criticalFiles = files.filter(file =>
    criticalPatterns.some(pattern => pattern.test(String(file)))
  );

  return Object.freeze({
    files,
    changedFiles: files.length,
    criticalFiles,
    critical: criticalFiles.length > 0,
    codeChange: files.length > 0
  });
}

function evaluatePolicy({ resource, state, action, change, policy = DEFAULT_POLICY }) {
  const r = normalizeResource(resource);
  normalizeState(state);
  if (!ACTIONS.includes(action)) throw new Error("unknown action: " + action);

  const impact = inspectChange(change || {});
  const reasons = [];

  if (policy.denyDeployFromFailedStates &&
      action === "DEPLOY" &&
      ["CI_FAILED", "SANDBOX_FAILED", "CI_FAILED_AFTER_REPAIR", "BLOCKED"].includes(state)) {
    reasons.push("deploy-from-failed-state");
  }

  if (policy.requireSandboxForCritical && impact.critical &&
      ["RUN_CI", "DEPLOY"].includes(action)) {
    reasons.push("critical-change-requires-sandbox");
  }

  if (policy.requireCiForCodeChanges && impact.codeChange &&
      action === "DEPLOY" &&
      state !== "CI_PASSED") {
    reasons.push("code-change-requires-ci-pass");
  }

  if (policy.requireReviewForCritical && impact.critical &&
      action === "DEPLOY" &&
      state !== "READY_FOR_REVIEW") {
    reasons.push("critical-change-requires-review");
  }

  const transition = action === "OBSERVE"
    ? true
    : evaluateTransition(state, action, {
        PROPOSE_PATCH: "AI_PATCH_PROPOSED",
        RUN_SANDBOX: "SANDBOX_RUNNING",
        RUN_CI: "CI_RUNNING",
        REQUEST_REVIEW: "READY_FOR_REVIEW",
        DEPLOY: "DEPLOYED"
      }[action] || state);

  if (!transition && action !== "OBSERVE") {
    reasons.push("invalid-state-transition");
  }

  return Object.freeze({
    allow: reasons.length === 0,
    decision: reasons.length === 0 ? "ALLOW" : "BLOCK",
    resource: r,
    state,
    action,
    impact,
    reasons
  });
}

function createProofReceipt({ resource, before, action, after, policyVersion, validation }) {
  const r = normalizeResource(resource);
  if (!before || !after) throw new TypeError("before and after states are required");
  return Object.freeze({
    version: 2,
    resource: r,
    transition: { from: before, action, to: after },
    policy: policyVersion || "default-v1",
    validation: Array.isArray(validation) ? [...validation] : [],
    createdAt: new Date().toISOString()
  });
}

module.exports = {
  STATES,
  ACTIONS,
  DEFAULT_POLICY,
  normalizeResource,
  inspectChange,
  evaluateTransition,
  evaluatePolicy,
  createProofReceipt
};
