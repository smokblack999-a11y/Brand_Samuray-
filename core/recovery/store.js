"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.RECOVERY_DATA_DIR || path.join(__dirname, "..", "data");
const JOB_FILE = path.join(DATA_DIR, "recovery-jobs.json");
const EVENT_FILE = path.join(DATA_DIR, "recovery-events.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(JOB_FILE)) fs.writeFileSync(JOB_FILE, "[]\n");
  if (!fs.existsSync(EVENT_FILE)) fs.writeFileSync(EVENT_FILE, "[]\n");
}
function read(file) {
  ensure();
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function write(file, rows) {
  ensure();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
function safeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}
function sanitizeEvidence(value) {
  if (value == null) return null;
  const text = JSON.stringify(value);
  if (/sk-(proj|svcacct)-|ghp_|github_pat_/i.test(text)) throw new Error("Secrets are forbidden in recovery evidence");
  return value;
}
function createJob(input = {}) {
  if (!input.source?.repo || !input.source?.runId) throw new Error("source.repo and source.runId are required");
  const now = new Date().toISOString();
  const job = {
    id: input.id || safeId("rec"),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    budget: {
      maxAttempts: Number(input.budget?.maxAttempts || 3),
      maxFilesChanged: Number(input.budget?.maxFilesChanged || 10),
      maxRuntimeSeconds: Number(input.budget?.maxRuntimeSeconds || 900)
    },
    source: {
      repo: String(input.source.repo),
      runId: String(input.source.runId),
      workflow: input.source.workflow ? String(input.source.workflow) : null,
      sha: input.source.sha ? String(input.source.sha) : null
    },
    failure: sanitizeEvidence(input.failure || {}),
    evidence: sanitizeEvidence(input.evidence || []),
    hypotheses: [],
    actions: [],
    proof: null
  };
  const jobs = read(JOB_FILE);
  if (jobs.some(x => x.id === job.id)) return jobs.find(x => x.id === job.id);
  jobs.push(job); write(JOB_FILE, jobs);
  appendEvent(job.id, "job.created", { status: job.status, source: job.source, failure: job.failure });
  return job;
}
function getJob(id) { return read(JOB_FILE).find(x => x.id === id) || null; }
function listJobs(limit = 100) { return read(JOB_FILE).slice(-Math.min(Math.max(Number(limit) || 100, 1), 500)).reverse(); }
function updateJob(id, patch) {
  const jobs = read(JOB_FILE);
  const i = jobs.findIndex(x => x.id === id);
  if (i < 0) throw new Error("recovery job not found");
  const next = { ...jobs[i], ...sanitizeEvidence(patch), updatedAt: new Date().toISOString() };
  jobs[i] = next; write(JOB_FILE, jobs);
  appendEvent(id, "job.updated", patch);
  return next;
}
function appendEvent(jobId, type, data = {}) {
  const events = read(EVENT_FILE);
  const event = { id: safeId("evt"), jobId, type, at: new Date().toISOString(), data: sanitizeEvidence(data) };
  events.push(event); write(EVENT_FILE, events); return event;
}
function listEvents(jobId, limit = 200) {
  return read(EVENT_FILE).filter(x => x.jobId === jobId).slice(-Math.min(Math.max(Number(limit) || 200, 1), 1000));
}
function createProof(job, finalState, extra = {}) {
  const proof = sanitizeEvidence({
    recoveryId: job.id,
    source: job.source,
    failure: job.failure,
    evidence: job.evidence,
    hypotheses: job.hypotheses,
    actions: job.actions,
    attempts: job.attempts,
    budget: job.budget,
    finalState,
    verified: Boolean(extra.verified),
    sandbox: extra.sandbox || null,
    tests: extra.tests || null,
    ci: extra.ci || null,
    filesChanged: extra.filesChanged || [],
    generatedAt: new Date().toISOString()
  });
  return updateJob(job.id, { proof, status: finalState === "recovered" ? "recovered" : finalState });
}
module.exports = { createJob, getJob, listJobs, updateJob, appendEvent, listEvents, createProof };
