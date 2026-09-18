"use strict";

const { runSandbox } = require("./nexus-sandbox");

function createSandboxGate({ runner = runSandbox } = {}) {
  return async function executeCandidate({
    workspace,
    commands,
    killDecision,
    proposal
  } = {}) {
    if (killDecision !== "PASS") {
      return {
        status: "KILLED",
        stage: "SANDBOX",
        decision: "KILL",
        reason: "Kill Critic did not PASS"
      };
    }

    if (!proposal || proposal.status !== "PATCH_CANDIDATE") {
      return {
        status: "HUMAN_REVIEW",
        stage: "SANDBOX",
        decision: "BLOCK",
        reason: "Patch proposal is not bounded"
      };
    }

    const sandbox = await runner({ workspace, commands });

    return {
      status: sandbox.passed ? "SANDBOX_PASS" : "HUMAN_REVIEW",
      stage: "SANDBOX",
      decision: sandbox.passed ? "PASS" : "BLOCK",
      sandbox
    };
  };
}

module.exports = { createSandboxGate };