"use strict";
require("dotenv").config();
const queue = require("./queue");
const github = require("./github-transport");
const { fingerprint } = require("../kill-critic");
const ACTIVE = new Set();
const MAX_ATTEMPTS = Math.max(1, Number(process.env.NEXUS_RECOVERY_MAX_ATTEMPTS || 3));
function failureEvidence(run, jobs) {
  const failedJobs = (jobs?.jobs || []).filter(job => job.conclusion === "failure" || job.conclusion === "timed_out");
  return failedJobs.map(job => ({ jobId: job.id, name: job.name, conclusion: job.conclusion, failedSteps: (job.steps || []).filter(step => step.conclusion === "failure").map(step => ({ name: step.name, number: step.number })) }));
}
async function diagnose(job) {
  if (!job.runId) throw Object.assign(new Error("Recovery job has no workflow run id"), { code: "RUN_ID_REQUIRED" });
  const run = await github.workflowRun(job.runId);
  const jobs = await github.workflowJobs(job.runId);
  const evidence = failureEvidence(run, jobs);
  const firstFailure = evidence[0]?.failedSteps?.[0] || {};
  const failure = { workflow: run.name, job: evidence[0]?.name, step: firstFailure.name, errorMessage: firstFailure.name, command: run.html_url };
  const incidentFingerprint = fingerprint(failure);
  return { fingerprint: incidentFingerprint, run: { id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, headBranch: run.head_branch, headSha: run.head_sha, htmlUrl: run.html_url }, evidence, failed: run.conclusion !== "success", repairable: evidence.length > 0 };
}
async function processJob(job) {
  if (!job || ACTIVE.has(job.id)) return null;
  if (job.status === "verified" || job.status === "stopped") return job;
  if (job.attempts >= MAX_ATTEMPTS) return queue.update(job.id, { status: "stopped", stopReason: "MAX_ATTEMPTS" });
  ACTIVE.add(job.id);
  queue.update(job.id, { status: "diagnosing", attempts: Number(job.attempts || 0) + 1 });
  try {
    const current = queue.get(job.id);
    const diagnosis = await diagnose(current);
    if (!diagnosis.failed) return queue.update(job.id, { status: "verified", diagnosis });
    if (!diagnosis.repairable) return queue.update(job.id, { status: "stopped", stopReason: "NO_ACTIONABLE_FAILURE_EVIDENCE", diagnosis });
    return queue.update(job.id, { status: "diagnosed", fingerprint: diagnosis.fingerprint, diagnosis, nextAction: "CANDIDATE_REQUIRED" });
  } catch (error) {
    return queue.update(job.id, { status: "failed", lastError: { code: error.code || "WORKER_FAILED", message: error.message } });
  } finally { ACTIVE.delete(job.id); }
}
async function processPending(limit = 10) {
  const jobs = queue.list(limit).filter(job => ["queued", "failed"].includes(job.status));
  const results = [];
  for (const job of jobs) results.push(await processJob(job));
  return results;
}
if (require.main === module) processPending().then(results => console.log(JSON.stringify({ ok: true, processed: results }, null, 2))).catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || "WORKER_FAILED", error: error.message })); process.exitCode = 1; });
module.exports = { failureEvidence, diagnose, processJob, processPending };
