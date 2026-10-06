"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("./nexus-resource-policy");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const QUEUE_FILE = path.join(DATA_DIR, "agent-control-queue.jsonl");
const TERMINAL = new Set(["success", "failure", "timed_out", "startup_failure", "cancelled", "action_required"]);

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "", "utf8");
}

function readAll() {
  ensureStore();
  return fs.readFileSync(QUEUE_FILE, "utf8").split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function append(record) {
  ensureStore();
  fs.appendFileSync(QUEUE_FILE, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
}

function now() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyGithubSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

function failureConclusion(conclusion) {
  return new Set(["failure", "timed_out", "startup_failure"]).has(String(conclusion || ""));
}

function classifyFailure(workflow) {
  const name = String(workflow?.name || "").toLowerCase();
  const conclusion = String(workflow?.conclusion || "").toLowerCase();
  if (!failureConclusion(conclusion)) return { category: "none", confidence: 1, evidenceRequired: false };

  if (conclusion === "timed_out") return { category: "timeout", confidence: 1, evidenceRequired: true };
  if (conclusion === "startup_failure") return { category: "runner_startup", confidence: 1, evidenceRequired: true };

  if (/test|ci|build|check|lint/.test(name)) return {
    category: "ci_failure",
    confidence: 0.55,
    evidenceRequired: true
  };

  return { category: "generic_ci_failure", confidence: 0.4, evidenceRequired: true };
}

function buildResource(workflow) {
  const repo = workflow?.repository?.full_name || workflow?.head_repository?.full_name;
  const id = workflow?.id;
  return repo && id ? `github://${repo}/actions/runs/${id}` : null;
}

function normalizeWorkflow(payload) {
  const w = payload?.workflow_run || {};
  return {
    id: w.id || null,
    name: w.name || null,
    event: w.event || null,
    status: w.status || null,
    conclusion: w.conclusion || null,
    headBranch: w.head_branch || null,
    headSha: w.head_sha || null,
    baseSha: w.base?.sha || null,
    repository: w.repository?.full_name || w.head_repository?.full_name || null,
    actor: w.actor?.login || null,
    htmlUrl: w.html_url || null
  };
}

function ingestWorkflowRun(payload, deliveryId) {
  const workflow = normalizeWorkflow(payload);
  if (!workflow.id || !workflow.repository) {
    const error = new Error("workflow_identity_missing");
    error.code = "INVALID_WORKFLOW_EVENT";
    throw error;
  }

  const eventKey = String(deliveryId || `workflow-run-${workflow.id}-${workflow.conclusion}`);
  const existing = readAll().find(x => x.type === "INGEST" && x.eventKey === eventKey);
  if (existing) return { duplicate: true, job: existing.job };

  const resource = buildResource(payload.workflow_run);
  const classification = classifyFailure(payload.workflow_run);
  const failed = failureConclusion(workflow.conclusion);

  const job = {
    id: `ac_${crypto.randomUUID()}`,
    state: failed ? "EVIDENCE_PENDING" : "OBSERVED",
    createdAt: now(),
    updatedAt: now(),
    eventKey,
    resource,
    workflow,
    classification,
    policy: failed
      ? policy.transition("CI_FAILED", "REPAIR_PROPOSED", {
          resource,
          files: [],
          diff: "",
          actor: "agent-control"
        })
      : null,
    diagnosis: {
      status: failed ? "pending" : "not_required",
      reproduction: false,
      causality: false,
      source: null
    },
    execution: {
      autonomousWrite: false,
      autonomousMerge: false,
      requiresSandbox: failed
    }
  };

  append({ type: "INGEST", at: now(), eventKey, job });
  return { duplicate: false, job };
}

function listJobs(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return readAll().filter(x => x.type === "INGEST").map(x => x.job).slice(-n).reverse();
}

function getJob(id) {
  return listJobs(200).find(job => job.id === String(id)) || null;
}

function diagnose(job, evidence = {}) {
  if (!job) {
    const error = new Error("job_not_found");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  const logs = String(evidence.logs || "");
  const patterns = [
    ["dependency", /npm ERR!|ERESOLVE|Could not resolve|peer dep/i],
    ["test", /FAIL(?:ED)?|AssertionError|test suite failed/i],
    ["syntax", /SyntaxError|parse error|unexpected token/i],
    ["timeout", /timeout|timed out|deadline exceeded/i],
    ["oom", /out of memory|heap out of memory|OOMKilled/i],
    ["auth", /401|403|unauthorized|forbidden|permission denied/i],
    ["network", /ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i],
    ["docker", /docker.*failed|container.*exited|buildkit/i],
  ];
  const matches = patterns.filter(([, re]) => re.test(logs)).map(([name]) => name);
  const category = matches[0] || job.classification.category || "unknown";
  const reproduction = evidence.reproduction === true;
  const causality = evidence.causality === true;

  const updated = {
    ...job,
    updatedAt: now(),
    state: reproduction && causality ? "REPAIR_ELIGIBLE" : "EVIDENCE_PENDING",
    diagnosis: {
      status: reproduction && causality ? "confirmed" : "insufficient_evidence",
      category,
      matches,
      reproduction,
      causality,
      source: evidence.source || "manual-or-external-evidence"
    }
  };

  append({ type: "DIAGNOSIS", at: now(), jobId: job.id, diagnosis: updated.diagnosis });
  return updated;
}

async function collectGithubEvidence(job, githubClient) {
  if (!job || !job.workflow || !job.workflow.repository || !job.workflow.id) {
    const error = new Error("GITHUB_WORKFLOW_IDENTITY_MISSING");
    error.code = "GITHUB_WORKFLOW_IDENTITY_MISSING";
    throw error;
  }
  if (!githubClient || typeof githubClient.collectFailureEvidence !== "function") {
    const error = new Error("GITHUB_EVIDENCE_CLIENT_MISSING");
    error.code = "GITHUB_EVIDENCE_CLIENT_MISSING";
    throw error;
  }
  const evidence = await githubClient.collectFailureEvidence(job.workflow.repository, job.workflow.id);
  const mergedLogs = (evidence.failedLogs || []).map(item => [
    "[job:" + item.jobId + "] " + (item.name || "unknown") + " [" + (item.conclusion || "unknown") + "]",
    item.content || "",
    item.error ? "[log_error:" + item.error + "]" : ""
  ].join("\n")).join("\n");
  return diagnose(job, {
    logs: mergedLogs,
    reproduction: false,
    causality: false,
    source: "github-actions",
    evidence: { runId: evidence.runId, repository: evidence.repository, jobs: evidence.jobs }
  });
}

function health() {
  ensureStore();
  const jobs = listJobs(200);
  return {
    ok: true,
    service: "X10THINK Agent Control",
    queueFile: QUEUE_FILE,
    jobs: jobs.length,
    pendingEvidence: jobs.filter(x => x.state === "EVIDENCE_PENDING").length,
    repairEligible: jobs.filter(x => x.state === "REPAIR_ELIGIBLE").length,
    autonomousWrite: false,
    autonomousMerge: false
  };
}

module.exports = {
  verifyGithubSignature,
  ingestWorkflowRun,
  listJobs,
  getJob,
  diagnose,
  collectGithubEvidence,
  health,
  classifyFailure
};
