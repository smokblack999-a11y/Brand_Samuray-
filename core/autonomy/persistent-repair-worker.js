"use strict";

/**
 * X27 persistent repair queue/state contract.
 *
 * The queue is deliberately storage-agnostic. Callers provide persistence;
 * this module never performs network, git, merge, or deployment actions.
 */

const STATES = Object.freeze({
  QUEUED: "queued",
  DIAGNOSING: "diagnosing",
  DIAGNOSED: "diagnosed",
  REJECTED: "rejected",
  PATCHING: "patching",
  TESTING: "testing",
  PROVEN: "proven",
  PR_OPEN: "pr_open",
  VERIFIED: "verified",
  STOPPED: "stopped"
});

const TERMINAL = new Set([STATES.REJECTED, STATES.VERIFIED, STATES.STOPPED]);

function createJob(input, maxAttempts = 2) {
  if (!input?.id) throw new Error("missing job id");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("invalid maxAttempts");
  return Object.freeze({
    ...input,
    state: STATES.QUEUED,
    attempts: 0,
    maxAttempts,
    history: [{ state: STATES.QUEUED, attempt: 0 }]
  });
}

function transition(job, next, meta = {}) {
  if (!job || TERMINAL.has(job.state)) throw new Error("job is terminal");
  const allowed = {
    [STATES.QUEUED]: [STATES.DIAGNOSING],
    [STATES.DIAGNOSING]: [STATES.DIAGNOSED, STATES.REJECTED],
    [STATES.DIAGNOSED]: [STATES.PATCHING, STATES.REJECTED],
    [STATES.PATCHING]: [STATES.TESTING, STATES.REJECTED],
    [STATES.TESTING]: [STATES.PROVEN, STATES.STOPPED],
    [STATES.PROVEN]: [STATES.PR_OPEN],
    [STATES.PR_OPEN]: [STATES.VERIFIED, STATES.TESTING, STATES.STOPPED]
  };
  if (!allowed[job.state]?.includes(next)) throw new Error(`invalid transition ${job.state} -> ${next}`);
  const attempts = next === STATES.TESTING ? job.attempts + 1 : job.attempts;
  if (attempts > job.maxAttempts) throw new Error("maxAttempts exceeded");
  return Object.freeze({
    ...job,
    state: next,
    attempts,
    history: [...job.history, { state: next, attempt: attempts, ...meta }]
  });
}

function recover(job) {
  if (!job?.id || !Array.isArray(job.history)) throw new Error("invalid persisted job");
  if (!Number.isInteger(job.attempts) || !Number.isInteger(job.maxAttempts)) throw new Error("invalid attempt counters");
  if (job.attempts > job.maxAttempts) throw new Error("persisted job exceeds maxAttempts");
  return Object.freeze({ ...job, history: job.history.map(x => Object.freeze({ ...x })) });
}

function shouldRetry(job) {
  return job.state === STATES.TESTING && job.attempts < job.maxAttempts;
}

module.exports = { STATES, createJob, transition, recover, shouldRetry };
