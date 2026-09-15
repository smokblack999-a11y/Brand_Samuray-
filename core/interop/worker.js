"use strict";

const { diagnose } = require("./diagnoser");
const { buildRepairPlan } = require("./repair-plan");
const { claimNext, transition } = require("./store");

function criticReview(evidence) {
  const integrity = evidence?.evidenceOnly === true && evidence?.credentialsRedacted === true;
  const concreteEvidence = evidence?.confidence === "high" && Array.isArray(evidence?.failedJobs) && evidence.failedJobs.some(job => job?.evidence?.excerpts?.length > 0);
  const reproduction = evidence?.reproduction === true;
  const causality = evidence?.causality === true;
  const security = integrity;
  return {
    passed: false,
    readyForPatchCandidate: Boolean(integrity && concreteEvidence && reproduction && causality),
    gates: { evidenceIntegrity: integrity, concreteEvidence, reproduction, causality, minimalPatch: false, regression: false, security },
    rule: "kill-critic-v2"
  };
}

async function processJob(job, deps = {}) {
  if (!job) return null;
  const runDiagnose = deps.diagnose || diagnose;
  const makeRepairPlan = deps.buildRepairPlan || buildRepairPlan;
  const move = deps.transition || transition;

  if (!job.workflowRunId) {
    return move(job.id, "HUMAN_REVIEW", { reason: "MISSING_WORKFLOW_RUN_ID" });
  }

  move(job.id, "DIAGNOSING");
  try {
    const evidence = await runDiagnose(job, deps);
    if (!evidence || !evidence.failedJobs?.length) {
      return move(job.id, "HUMAN_REVIEW", { reason: "INSUFFICIENT_FAILURE_EVIDENCE", evidence: evidence || null });
    }
    if (evidence.evidenceOnly !== true || !evidence.workflowRunId) {
      return move(job.id, "STOPPED", { reason: "INVALID_EVIDENCE" });
    }

    const critic = criticReview(evidence);
    const repairPlan = makeRepairPlan(evidence);
    return move(job.id, "CRITIC_REVIEW", { diagnosis: evidence, critic, repairPlan });
  } catch (error) {
    const message = String(error?.message || error);
    if (/GITHUB_TOKEN is required/.test(message)) {
      return move(job.id, "HUMAN_REVIEW", { reason: "GITHUB_AUTH_NOT_CONFIGURED" });
    }
    return move(job.id, "HUMAN_REVIEW", { reason: "DIAGNOSIS_ERROR", error: message.slice(0, 300) });
  }
}

async function runOnce(deps = {}) {
  const job = (deps.claimNext || claimNext)();
  if (!job) return null;
  return processJob(job, deps);
}

async function runForever(deps = {}) {
  const intervalMs = Math.max(250, Number(deps.intervalMs || process.env.INTEROP_WORKER_INTERVAL_MS || 1000));
  while (true) {
    await runOnce(deps);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

if (require.main === module) {
  if (process.env.INTEROP_WORKER_ENABLED !== "true") {
    console.error("INTEROP_WORKER_ENABLED=true is required");
    process.exitCode = 1;
  } else {
    runForever().catch(error => {
      console.error("interop worker fatal:", error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { processJob, runOnce, runForever, criticReview };
