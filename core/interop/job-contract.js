"use strict";

const STAGES = Object.freeze([
  "QUEUED",
  "RUNNING",
  "DIAGNOSING",
  "CRITIC_REVIEW",
  "PATCHING",
  "SANDBOX",
  "VERIFYING",
  "VERIFIED",
  "RETRY",
  "HUMAN_REVIEW",
  "STOPPED"
]);

const TERMINAL_STAGES = new Set(["VERIFIED", "HUMAN_REVIEW", "STOPPED"]);
const MAX_ATTEMPTS = 3;

function createJob(input = {}) {
  if (!input.type) throw new TypeError("job.type is required");
  if (!input.repository) throw new TypeError("job.repository is required");

  return {
    schemaVersion: 1,
    id: input.id || null,
    type: String(input.type),
    repository: String(input.repository),
    pullRequest: input.pullRequest == null ? null : Number(input.pullRequest),
    commit: input.commit == null ? null : String(input.commit),
    attempt: Number.isInteger(input.attempt) ? input.attempt : 0,
    stage: input.stage || "QUEUED",
    parentJobId: input.parentJobId || null,
    correlationId: input.correlationId || null,
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function canRetry(job) {
  return !TERMINAL_STAGES.has(job.stage) && Number(job.attempt) < MAX_ATTEMPTS;
}

function nextRetry(job) {
  if (!canRetry(job)) return null;
  return { ...job, attempt: Number(job.attempt) + 1, stage: "RETRY" };
}

module.exports = { STAGES, TERMINAL_STAGES, MAX_ATTEMPTS, createJob, canRetry, nextRetry };
