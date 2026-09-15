"use strict";

const PLAN_VERSION = 2;

function commandFor(category, command, evidenceCommand) {
  const selected = Array.isArray(command) && command.length
    ? command
    : Array.isArray(evidenceCommand) && evidenceCommand.length
      ? evidenceCommand
      : null;
  if (!selected) {
    throw new TypeError(`exact reproduction command required for ${category || "generic"}`);
  }
  return selected.map(String);
}

function buildReproductionPlan(evidence, command) {
  if (!evidence || evidence.evidenceOnly !== true) throw new TypeError("evidence-only diagnosis is required");
  if (!evidence.workflowRunId) throw new TypeError("workflowRunId is required");
  const category = String(evidence.category || "generic");
  return {
    version: PLAN_VERSION,
    workflowRunId: Number(evidence.workflowRunId),
    category,
    command: commandFor(category, command, evidence.command),
    required: ["baselineFailure", "patchedVerification"],
    rule: "exact-command-baseline-must-fail-and-patched-run-must-pass"
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
    rule: "reproduction-gate-v2"
  };
}

module.exports = { PLAN_VERSION, commandFor, buildReproductionPlan, evaluateReproduction };
