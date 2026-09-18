const { DEFAULT_POLICY, diagnose, proposeRepair, killCritic, buildProofReceipt } = require("./proof-repair-engine");
const { routeWorkflowRun } = require("./event-proof-router");
const { STATES, createJob, transition } = require("./persistent-repair-worker");

/**
 * X10THINC X28 Repair Orchestrator.
 * Pure orchestration: GitHub event -> bounded repair -> proof decision.
 * External adapters own persistence, sandbox execution, git, PR creation and deployment.
 */
function ingest(event, existingJobKeys = new Set()) {
  return routeWorkflowRun(event, { existingJobKeys });
}

function start(event, existingJobKeys = new Set(), policy = DEFAULT_POLICY) {
  const routed = ingest(event, existingJobKeys);
  if (routed.action !== "enqueue_repair") return Object.freeze({ routed, job: null });
  const job = createJob(routed.job, policy.maxAttempts);
  return Object.freeze({ routed, job });
}

function diagnoseJob(job) {
  return transition(
    transition(job, STATES.DIAGNOSING),
    STATES.DIAGNOSED,
    { diagnosis: diagnose(job.failure) }
  );
}

function evaluateRepair(job, candidate, policy = DEFAULT_POLICY) {
  const diagnosis = job.diagnosis || diagnose(job.failure);
  const repair = proposeRepair({ diagnosis, candidate });
  const critic = killCritic({ failure: job.failure, diagnosis, repair, policy });
  if (critic.decision === "REJECT") {
    return Object.freeze({
      job: transition(job, STATES.REJECTED, { critic }),
      repair,
      critic
    });
  }
  return Object.freeze({
    job: transition(job, STATES.PATCHING, { repair, critic }),
    repair,
    critic
  });
}

function recordTest(job, repair, critic, testResult) {
  if (job.state !== STATES.PATCHING) throw new Error("job must be patching before testing");
  const testing = transition(job, STATES.TESTING, { testResult });
  const receipt = buildProofReceipt({
    jobId: job.id,
    failure: job.failure,
    diagnosis: job.diagnosis || diagnose(job.failure),
    repair,
    critic,
    testResult
  });
  if (receipt.status === "PROVEN") {
    return Object.freeze({
      job: transition(testing, STATES.PROVEN, { proof: receipt }),
      proof: receipt
    });
  }
  return Object.freeze({ job: testing, proof: receipt });
}

function openPr(job, pullRequest) {
  if (job.state !== STATES.PROVEN) throw new Error("job must be proven before PR");
  return transition(job, STATES.PR_OPEN, { pullRequest });
}

function verifyPr(job, ciResult) {
  if (job.state !== STATES.PR_OPEN) throw new Error("job must have an open PR");
  if (ciResult?.passed === true) {
    return transition(job, STATES.VERIFIED, { ciResult });
  }
  if (job.attempts < job.maxAttempts) {
    return transition(job, STATES.TESTING, { ciResult, retry: true });
  }
  return transition(job, STATES.STOPPED, { ciResult, reason: "maxAttempts exhausted" });
}

module.exports = {
  ingest,
  start,
  diagnoseJob,
  evaluateRepair,
  recordTest,
  openPr,
  verifyPr
};
