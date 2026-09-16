"use strict";

const { runSandbox } = require("./sandbox");
const { evaluateReproduction } = require("./reproduction-gate");

async function runReproduction(options = {}) {
  const workspace = String(options.workspace || "").trim();
  if (!workspace) throw new TypeError("workspace is required");
  if (!options.plan || !Array.isArray(options.plan.command) || !options.plan.command.length) {
    throw new TypeError("reproduction plan with command is required");
  }
  if (!options.patch) throw new TypeError("patch is required");

  const command = options.plan.command.map(String);
  const baseline = await runSandbox({ workspace, command, timeoutMs: options.timeoutMs });
  const patched = await runSandbox({ workspace, command, patch: options.patch, timeoutMs: options.timeoutMs });
  const proof = evaluateReproduction(options.plan, baseline, patched);

  return {
    planVersion: options.plan.version,
    reproduction: proof.reproduction,
    causality: proof.causality,
    passed: proof.passed,
    gates: proof.gates,
    baseline,
    patched,
    rule: proof.rule
  };
}

module.exports = { runReproduction };
