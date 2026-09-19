"use strict";

/**
 * X29 -> X28 bridge.
 *
 * Architect Core owns planning/delegation. X28 remains the only repair
 * state machine. This adapter prevents a second competing lifecycle.
 */

const {
  start,
  diagnoseJob,
  evaluateRepair,
  recordTest,
  openPr,
  verifyPr
} = require("./autonomy/repair-orchestrator");

function createX28Adapter({ policy, existingJobKeys = new Set() } = {}) {
  return Object.freeze({
    async plan({ mission }) {
      const event = mission?.input?.workflowRun || mission?.input?.event;
      if (!event) {
        return { actions: [], tests: [], reason: "missing_workflow_event" };
      }

      const started = start(event, existingJobKeys, policy);
      return {
        actions: started.job ? ["diagnose", "critic", "sandbox", "test", "pr", "ci"] : [],
        tests: [],
        x28: started
      };
    },

    async criticEvaluate({ x28, candidate }) {
      if (!x28?.job) return { decision: "ESCALATE", reason: "not_routed_to_x28" };

      const diagnosed = diagnoseJob(x28.job);
      const evaluated = evaluateRepair(diagnosed, candidate, policy);
      return {
        decision: evaluated.critic.decision === "PASS" ? "ALLOW" : "REJECT",
        x28: evaluated,
        reasons: evaluated.critic.reasons
      };
    },

    async recordSandboxTest({ evaluated, testResult }) {
      if (!evaluated?.job || !evaluated.repair || !evaluated.critic) {
        throw new Error("missing X28 repair evaluation");
      }

      return recordTest(
        evaluated.job,
        evaluated.repair,
        evaluated.critic,
        testResult
      );
    },

    async openPullRequest({ provenJob, pullRequest }) {
      return openPr(provenJob, pullRequest);
    },

    async verifyPullRequest({ prJob, ciResult }) {
      return verifyPr(prJob, ciResult);
    }
  });
}

module.exports = { createX28Adapter };
