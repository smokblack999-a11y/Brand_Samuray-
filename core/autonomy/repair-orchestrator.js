const { DEFAULT_POLICY, diagnose, proposeRepair, killCritic, buildProofReceipt } = require("./proof-repair-engine");
const { routeWorkflowRun } = require("./event-proof-router");
const { STATES, createJob, transition } = require("./persistent-repair-worker");

/**
 * X10THINC X28 Repair Orchestrator + X29 Architect integration.
 *
 * X29 owns planning/delegation policy. X28 remains the single execution
 * state machine and proof pipeline. This adapter prevents a second
 * competing state machine from being introduced.
 *
 * External adapters own persistence, sandbox execution, git, PR creation
 * and deployment.
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

/**
 * Convert an X29 Architect plan into the existing X28 repair pipeline.
 *
 * The architect may propose actions, tests and constraints, but it cannot
 * bypass X28 transitions or proof requirements.
 */
function applyArchitectPlan(job, architectResult) {
  if (!architectResult || typeof architectResult !== "object") {
    throw new TypeError("architectResult is required");
  }

  const plan = architectResult.plan || architectResult;
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const tests = Array.isArray(plan.tests) ? plan.tests : [];
  const constraints = Array.isArray(plan.constraints) ? plan.constraints : [];

  return Object.freeze({
    ...job,
    architect: Object.freeze({
      status: architectResult.status || "planned",
      plan: Object.freeze({
        actions: [...actions],
        tests: [...tests],
        constraints: [...constraints]
      })
    })
  });
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
  applyArchitectPlan,
  evaluateRepair,
  recordTest,
  openPr,
  verifyPr
};
