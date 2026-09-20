"use strict";

/**
 * X29 Architect Adapter
 * X29 owns strategy; X28 owns execution state and proof transitions.
 */

const { DEFAULT_POLICY, diagnose, proposeRepair, killCritic } = require("./proof-repair-engine");
const { start, diagnoseJob, evaluateRepair, recordTest, openPr, verifyPr } = require("./repair-orchestrator");

function createRepairMission({ event, existingJobKeys = new Set(), policy = DEFAULT_POLICY }) {
  const started = start(event, existingJobKeys, policy);
  if (!started.job) return Object.freeze({ started, mission: null });
  return Object.freeze({
    started,
    mission: Object.freeze({
      id: started.job.id,
      type: "ci-repair",
      input: {
        failure: started.job.failure,
        workflow: started.job.workflow,
        repository: started.job.repository
      }
    })
  });
}

function planMission(mission, specialistPlan = {}) {
  if (!mission?.id) throw new TypeError("mission.id is required");
  return Object.freeze({
    missionId: mission.id,
    strategy: specialistPlan.strategy || "bounded-repair",
    diagnosis: diagnose(mission.input.failure),
    candidate: specialistPlan.candidate || null,
    requiredEvidence: [
      "reproducible_failure_or_reason",
      "kill_critic_pass",
      "sandbox_or_test_pass",
      "github_ci_result"
    ]
  });
}

function applyPlan(startedJob, plan, policy = DEFAULT_POLICY) {
  if (!startedJob?.job) throw new TypeError("startedJob.job is required");
  if (!plan?.candidate) throw new TypeError("plan.candidate is required");
  return evaluateRepair(diagnoseJob(startedJob.job), plan.candidate, policy);
}

function recordVerification(repairState, testResult) {
  if (!repairState?.job || !repairState.repair || !repairState.critic) {
    throw new TypeError("repair state is incomplete");
  }
  return recordTest(repairState.job, repairState.repair, repairState.critic, testResult);
}

function attachPullRequest(provenJob, pullRequest) {
  return openPr(provenJob, pullRequest);
}

function attachCiResult(prJob, ciResult) {
  return verifyPr(prJob, ciResult);
}

module.exports = {
  createRepairMission, planMission, applyPlan, recordVerification,
  attachPullRequest, attachCiResult, proposeRepair, killCritic
};
