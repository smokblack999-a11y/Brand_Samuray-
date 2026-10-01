"use strict";

const crypto = require("crypto");

const STATES = Object.freeze([
  "DETECTED",
  "RECALLING_PATTERNS",
  "PROPOSING_PATCH",
  "POLICY_CHECKING",
  "SANDBOX_PENDING",
  "SANDBOX_RUNNING",
  "CRITIC_EVALUATION",
  "PROOF_GENERATION",
  "HUMAN_APPROVAL_REQUIRED",
  "PR_CREATING",
  "CI_PENDING",
  "RESOLVED",
  "REJECTED",
  "FAILED_RECOVERY"
]);

const RISKS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const TRANSITIONS = Object.freeze({
  DETECTED: ["RECALLING_PATTERNS", "PROPOSING_PATCH", "REJECTED", "FAILED_RECOVERY"],
  RECALLING_PATTERNS: ["PROPOSING_PATCH", "HUMAN_APPROVAL_REQUIRED", "FAILED_RECOVERY"],
  PROPOSING_PATCH: ["POLICY_CHECKING", "REJECTED", "FAILED_RECOVERY"],
  POLICY_CHECKING: ["SANDBOX_PENDING", "HUMAN_APPROVAL_REQUIRED", "REJECTED", "FAILED_RECOVERY"],
  SANDBOX_PENDING: ["SANDBOX_RUNNING", "HUMAN_APPROVAL_REQUIRED", "FAILED_RECOVERY"],
  SANDBOX_RUNNING: ["CRITIC_EVALUATION", "FAILED_RECOVERY", "REJECTED"],
  CRITIC_EVALUATION: ["PROOF_GENERATION", "REJECTED", "HUMAN_APPROVAL_REQUIRED"],
  PROOF_GENERATION: ["PR_CREATING", "HUMAN_APPROVAL_REQUIRED", "REJECTED"],
  HUMAN_APPROVAL_REQUIRED: ["PR_CREATING", "REJECTED", "FAILED_RECOVERY"],
  PR_CREATING: ["CI_PENDING", "FAILED_RECOVERY"],
  CI_PENDING: ["RESOLVED", "FAILED_RECOVERY", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
  FAILED_RECOVERY: []
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function policyFor({ risk = "HIGH", repository = "" } = {}) {
  if (!RISKS.has(risk)) throw new Error("invalid_risk");

  const protectedRepo = /^(main|master|production|prod)$/i.test(String(repository));
  const highRisk = risk === "HIGH" || risk === "CRITICAL";

  return {
    autonomous_execution: true,
    production_mutation: false,
    merge: highRisk || protectedRepo ? "HUMAN_REQUIRED" : "HUMAN_REQUIRED",
    network: "DENY",
    protected_repository: protectedRepo,
    policy_version: "x10-policy-v1"
  };
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

function validateIncident(input = {}) {
  const required = ["incident_id", "event_id", "repository", "commit_sha", "failure_fingerprint"];
  for (const key of required) {
    if (!String(input[key] || "").trim()) throw new Error(`missing_${key}`);
  }
  if (!/^[0-9a-f]{7,64}$/i.test(String(input.commit_sha))) throw new Error("invalid_commit_sha");
  if (!RISKS.has(input.risk || "HIGH")) throw new Error("invalid_risk");
  return true;
}

function evaluateTransition({ incident, toState, actor, reason, killSwitch = false }) {
  if (!incident) throw new Error("incident_not_found");
  if (!STATES.includes(toState)) throw new Error("invalid_target_state");

  if (killSwitch && toState !== "HUMAN_APPROVAL_REQUIRED" &&
      toState !== "REJECTED" && toState !== "FAILED_RECOVERY") {
    return {
      decision: "BLOCK",
      state: "HUMAN_APPROVAL_REQUIRED",
      reason: "kill_switch_active",
      actor: "KillSwitch"
    };
  }

  if (!canTransition(incident.state, toState)) {
    return {
      decision: "BLOCK",
      state: incident.state,
      reason: "invalid_state_transition",
      fromState: incident.state,
      toState
    };
  }

  return {
    decision: "ALLOW",
    state: toState,
    fromState: incident.state,
    toState,
    actor: actor || "ControlPlane",
    reason: reason || "state_transition",
    transition_hash: sha256(JSON.stringify({
      incident_id: incident.incident_id,
      from: incident.state,
      to: toState,
      actor: actor || "ControlPlane",
      reason: reason || "state_transition"
    }))
  };
}

module.exports = {
  STATES,
  TRANSITIONS,
  policyFor,
  canTransition,
  validateIncident,
  evaluateTransition,
  sha256
};
