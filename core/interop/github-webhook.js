"use strict";

const crypto = require("node:crypto");
const { createJob } = require("./job-contract");
const { enqueue } = require("./store");

function verifySignature(secret, rawBody, signature) {
  if (!secret || !Buffer.isBuffer(rawBody) || !signature) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeWorkflowRun(payload, deliveryId) {
  const run = payload?.workflow_run;
  if (!run || payload?.action !== "completed") return null;
  if (run.conclusion !== "failure") return null;

  const repository = run.head_repository?.full_name || payload.repository?.full_name;
  if (!repository || !run.head_sha || !run.id) return null;

  const pullRequest = Array.isArray(run.pull_requests) && run.pull_requests[0]
    ? Number(run.pull_requests[0].number)
    : null;

  return {
    eventKey: `github:workflow_run:${deliveryId || run.id}`,
    job: createJob({
      type: "CI_FAILURE",
      repository,
      pullRequest: Number.isInteger(pullRequest) ? pullRequest : null,
      commit: run.head_sha,
      correlationId: `workflow-run:${run.id}`
    }),
    workflowRunId: Number(run.id),
    workflowName: String(run.name || "unknown"),
    conclusion: "failure",
    runUrl: run.html_url || null
  };
}

function handleWorkflowRun(payload, deliveryId) {
  const normalized = normalizeWorkflowRun(payload, deliveryId);
  if (!normalized) return { accepted: false, reason: "ignored" };

  const { eventKey, job, ...metadata } = normalized;
  return { accepted: true, ...enqueue({ ...job, ...metadata }, eventKey) };
}

module.exports = { verifySignature, normalizeWorkflowRun, handleWorkflowRun };
