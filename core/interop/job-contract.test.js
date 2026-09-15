"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createJob, canRetry, nextRetry, MAX_ATTEMPTS } = require("./job-contract");

test("creates a queue-safe job without credentials", () => {
  const job = createJob({ type: "ci_failure", repository: "owner/repo", pullRequest: 7 });
  assert.equal(job.stage, "QUEUED");
  assert.equal(job.attempt, 0);
  assert.equal("token" in job, false);
  assert.equal("password" in job, false);
});

test("bounds retries", () => {
  let job = createJob({ type: "compatibility_scan", repository: "owner/repo" });
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) job = nextRetry(job);
  assert.equal(job.stage, "RETRY");
  assert.equal(job.attempt, MAX_ATTEMPTS);
  assert.equal(canRetry(job), false);
  assert.equal(nextRetry(job), null);
});

test("terminal jobs cannot retry", () => {
  const job = createJob({ type: "verification", repository: "owner/repo", stage: "VERIFIED" });
  assert.equal(canRetry(job), false);
  assert.equal(nextRetry(job), null);
});
