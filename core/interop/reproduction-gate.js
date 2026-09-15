"use strict";

const PLAN_VERSION = 1;
const DEFAULT_COMMANDS = Object.freeze({
  dependency_error: ["npm", "install", "--ignore-scripts"],
  test_failure: ["npm", "test"],
  syntax_error: ["node", "--check", "core/server.js"],
  timeout: ["npm", "test"],
  generic: ["npm", "test"]
});

function commandFor(category, command) {
  if (Array.isArray(command) && command.length) return command.map(String);
  return [...(DEFAULT_COMMANDS[category] || DEFAULT_COMMANDS.generic)];
}

function buildReproductionPlan(evidence, command) {
  if (!evidence || evidence.evidenceOnly !== true) throw new TypeError("evidence-only diagnosis is required");
  if (!evidence.workflowRunId) throw new TypeError("workflowRunId is required");
  const category = String(evidence.category || "generic");
  return {
    version: PLAN_VERSION,
    workflowRunId: Number(evidence.workflowRunId),
    category,
    command: commandFor(category, command),
    required: ["baselineFailure", "patchedVerification"],
    rule: "same-command-baseline-must-fail-and-patched-run-must-pass"
  };
}

function evaluateReproduction(plan, baseline, patched) {
  if (!plan || plan.version !== PLAN_VERSION) throw new TypeError("valid reproduction plan is required");
  const baselineFailure = baseline?.isolated === true && baseline?.verified === false;
  const patchedPass = patched?.isolated === true && patched?.verified === true;
  const sameCommand = JSON.stringify(baseline?.command || []) === JSON.stringify(patched?.command || []);
  const categoryMatch = !plan.category || plan.category === "generic" || baseline?.category === plan.category;
  const causality = baselineFailure && patchedPass && sameCommand && categoryMatch;
  return {
    reproduction: baselineFailure,
    causality,
    passed: causality,
    gates: { isolatedBaseline: baseline?.isolated === true, baselineFailure, patchedPass, sameCommand, categoryMatch },
    rule: "reproduction-gate-v1"
  };
}

module.exports = { PLAN_VERSION, DEFAULT_COMMANDS, commandFor, buildReproductionPlan, evaluateReproduction };
