"use strict";

const { createVerifiedProofReceipt } = require("./nexus-proof-receipt");

function createProofGate({ receiptFactory = createVerifiedProofReceipt } = {}) {
  return function finalizeProof(input = {}) {
    if (input.sandbox?.passed !== true) {
      return { status: "BLOCKED", stage: "PROOF", decision: "BLOCK", reason: "Sandbox evidence did not PASS" };
    }
    if (input.critic?.decision !== "PASS") {
      return { status: "KILLED", stage: "PROOF", decision: "KILL", reason: "Kill Critic did not PASS" };
    }

    try {
      const receipt = receiptFactory(input);
      return {
        status: "PROOF_READY",
        stage: "PROOF",
        decision: "SHIP",
        receipt
      };
    } catch (error) {
      return {
        status: "HUMAN_REVIEW",
        stage: "PROOF",
        decision: "BLOCK",
        reason: error.message
      };
    }
  };
}

module.exports = { createProofGate };
