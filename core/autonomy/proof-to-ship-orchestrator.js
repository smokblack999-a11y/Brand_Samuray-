/**
 * X10THINC X28 Proof-to-Ship Orchestrator.
 *
 * Composes X26 event routing, X25 diagnosis/Kill Critic/proof, and X27
 * persistent state transitions into one deterministic contract.
 *
 * Adapters outside this module perform sandbox execution and GitHub I/O.
 * This module never edits files, pushes, merges, or deploys.
 */

const { routeWorkflowRun } = require("./event-proof-router");
const { diagnose, proposeRepair, killCritic, buildProofReceipt, DEFAULT_POLICY } = require("./proof-repair-engine");
const { STATES, createJob, transition, shouldRetry } = require("./persistent-repair-worker");

function ingest(event, existingJobKeys = new Set()) {
  const routed = routeWorkflowRun(event, { existingJobKeys });
  if (routed.action !== "enqueue_repair") return Object.freeze({ routed });

  const job = createJob(routed.job, DEFAULT_POLICY.maxAttempts);
  return Object.freeze({ routed, job });
}

function startDiagnosis(job) {
  return transition(job, STATES.DIAGNOSING);
}

function finishDiagnosis(job) {
  const diagnosis = diagnose(job.failure);
  return Object.freeze({
    job: transition(job, STATES.DIAGNOSED, { diagnosis: diagnosis.category }),
    diagnosis
  });
}

function evaluateCandidate(job, diagnosis, candidate, policy = DEFAULT_POLICY) {
  const repair = proposeRepair({ diagnosis, candidate });
  const critic = killCritic({ failure: job.failure, diagnosis, repair, policy });

  if (critic.decision === "REJECT") {
    return Object.freeze({
      job: transition(job, STATES.REJECTED, { reasons: critic.reasons }),
      repair,
      critic
    });
  }

  return Object.freeze({
    job: transition(job, STATES.PATCHING, { changedFiles: repair.changedFiles }),
    repair,
    critic
  });
}

function beginTesting(job) {
  return transition(job, STATES.TESTING);
}

function recordTest(job, { passed, command = "", exitCode = null } = {}) {
  if (job.state !== STATES.TESTING) throw new Error("job must be testing");
  if (passed === true) return transition(job, STATES.PROVEN, { test: { passed: true, command, exitCode } });
  if (shouldRetry(job)) return transition(job, STATES.PATCHING, { test: { passed: false, command, exitCode }, retryAvailable: true });
  return transition(job, STATES.STOPPED, { test: { passed: false, command, exitCode }, retryAvailable: false });
}

function buildReceipt(job, diagnosis, repair, critic, testResult) {
  return buildProofReceipt({
    jobId: job.id,
    failure: job.failure,
    diagnosis,
    repair,
    critic,
    testResult
  });
}

function openPr(job, pr = {}) {
  if (job.state !== STATES.PROVEN) throw new Error("job must be proven");
  return transition(job, STATES.PR_OPEN, {
    pullRequest: {
      number: pr.number ?? null,
      url: String(pr.url || ""),
      head: String(pr.head || ""),
      base: String(pr.base || "main")
    }
  });
}

function verifyPr(job, result = {}) {
  if (job.state !== STATES.PR_OPEN) throw new Error("job must be pr_open");
  if (result.passed === true) return transition(job, STATES.VERIFIED, { verification: result });
  if (shouldRetry(job)) return transition(job, STATES.TESTING, { verification: result });
  return transition(job, STATES.STOPPED, { verification: result });
}

module.exports = {
  ingest,
  startDiagnosis,
  finishDiagnosis,
  evaluateCandidate,
  beginTesting,
  recordTest,
  buildReceipt,
  openPr,
  verifyPr
};
