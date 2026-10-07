"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("./nexus-resource-policy");
const orchestrator = require("./nexus-repair-orchestrator");
const evidence = require("./agent-evidence");
const intent = require("./agent-intent");
const approval = require("./agent-approval");

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

  const orchestratorJob = failed
    ? orchestrator.createJob({
        resource,
        workflowRunId: workflow.id,
        changedFiles: [],
        headSha: workflow.headSha,
        conclusion: workflow.conclusion
      })
    : null;

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
    },
    orchestrator: orchestratorJob,
    evidenceChain: evidence.createChain({
      subject: `workflow_run:${workflow.id}`,
      intent: failed ? "repair_ci_failure" : "observe_ci_run",
      initialEvidence: { source: "github.workflow_run", workflow }
    })
  };

  append({ type: "INGEST", at: now(), eventKey, job });
  return { duplicate: false, job };
}

function listJobs(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return readAll().filter(x => x.type === "INGEST").map(x => x.job).slice(-n).reverse();
}

function getJob(id) {
  const records = readAll().filter(record => record.jobId === String(id) || record.job?.id === String(id));
  const first = records.find(record => record.type === "INGEST");
  if (!first) return null;
  let job = first.job;
  for (const record of records) {
    if (record.type === "STATE" && record.job) job = record.job;
  }
  return job;
}

function diagnose(job, diagnosticEvidence = {}) {
  if (!job) {
    const error = new Error("job_not_found");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  job = job.evidenceChain ? job : {
    ...job,
    evidenceChain: evidence.createChain({
      subject: `job:${job.id || "unknown"}`,
      intent: "ci_failure_diagnosis",
      initialEvidence: { source: "synthetic-or-legacy-job" }
    })
  };
  const logs = String(diagnosticEvidence.logs || "");
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
  const reproduction = diagnosticEvidence.reproduction === true;
  const causality = diagnosticEvidence.causality === true;

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
      source: diagnosticEvidence.source || "manual-or-external-evidence"
    }
  };

  let finalJob = updated;
  if (reproduction && causality && updated.orchestrator) {
    const state = updated.orchestrator.state === "QUEUED"
      ? orchestrator.nextState(updated.orchestrator, "DIAGNOSING", {
          evidence: updated.diagnosis.source,
          reproduction: true,
          causality: true
        })
      : updated.orchestrator;
    finalJob = {...updated, orchestrator: state};
  }

  const evidenceRecord = evidence.append(finalJob.evidenceChain, { type: "diagnosis", intent: finalJob.workflow?.name || "ci_failure_diagnosis", action: "diagnose", decision: finalJob.state === "REPAIR_ELIGIBLE" ? "ALLOW_NEXT_STAGE" : "HOLD", evidence: finalJob.diagnosis });
  finalJob = {...finalJob, evidenceChain: evidenceRecord.chain};
  append({ type: "DIAGNOSIS", at: now(), jobId: job.id, diagnosis: finalJob.diagnosis, evidence: evidenceRecord.record });
  append({ type: "STATE", at: now(), jobId: job.id, job: finalJob });
  return finalJob;
}

async function reproduceRepair(job, proposal = {}, sandboxClient) {
  if (!job) {
    const error = new Error("job_not_found");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  if (!job.orchestrator) throw new Error("ORCHESTRATOR_JOB_MISSING");
  if (!sandboxClient || typeof sandboxClient.reproduceRepair !== "function") {
    const error = new Error("SANDBOX_REPRODUCTION_CLIENT_MISSING");
    error.code = "SANDBOX_REPRODUCTION_CLIENT_MISSING";
    throw error;
  }

  const semantic = intent.analyze({
    intent: proposal.intent,
    changedFiles: proposal.changedFiles || job.orchestrator.changedFiles || job.changedFiles
  });
  if (semantic.decision !== "ALLOW") {
    const er = evidence.append(job.evidenceChain, {
      type: "intent_gate",
      intent: proposal.intent || "missing",
      action: "semantic_scope_check",
      decision: "BLOCK",
      evidence: semantic
    });
    const updated = {...job, updatedAt: now(), intentGate: semantic, evidenceChain: er.chain};
    append({ type: "STATE", at: now(), jobId: job.id, job: updated });
    return updated;
  }

  const runResult = await sandboxClient.reproduceRepair({
    runId: `repro_${job.workflow.id}_${crypto.randomUUID()}`,
    incidentId: job.id,
    repository: job.workflow.repository,
    commitSha: job.workflow.headSha,
    patchDiff: proposal.diff,
    workspacePath: proposal.workspacePath,
    testCommand: proposal.testCommand
  });

  const baselineFailure = failureConclusion(job.workflow.conclusion);
  const sameCommit = runResult.commitSha === job.workflow.headSha;
  const candidatePassed = runResult.passed === true;
  const environmentBound = Boolean(runResult.environmentHash);
  const causal = baselineFailure && sameCommit && candidatePassed && environmentBound && runResult.timeout === false;

  const diagnosis = {
    ...(job.diagnosis || {}),
    status: causal ? "confirmed" : "insufficient_evidence",
    reproduction: baselineFailure,
    causality: causal,
    source: "github-baseline-plus-sandbox-candidate",
    reproductionEvidence: {
      baseline: {
        workflowRunId: job.workflow.id,
        conclusion: job.workflow.conclusion,
        headSha: job.workflow.headSha
      },
      candidate: {
        runId: runResult.runId,
        passed: candidatePassed,
        commitSha: runResult.commitSha,
        patchSha256: runResult.patchSha256,
        environmentHash: runResult.environmentHash,
        timeout: runResult.timeout,
        networkAccess: runResult.networkAccess
      },
      causalBasis: [
        "baseline_ci_failure",
        "same_head_sha",
        "candidate_passed",
        "sandbox_environment_bound"
      ]
    }
  };

  const next = causal ? orchestrator.nextState(job.orchestrator, job.orchestrator.state === "QUEUED" ? "DIAGNOSING" : job.orchestrator.state, { reproduction: true, causality: true }) : job.orchestrator;
  const er = evidence.append(job.evidenceChain, {
    type: "reproduction",
    intent: proposal.intent,
    action: "sandbox_candidate",
    decision: causal ? "ALLOW_REPAIR_EVALUATION" : "HOLD",
    evidence: { diagnosis, sandbox: runResult }
  });
  const updated = {
    ...job,
    updatedAt: now(),
    state: causal ? "REPAIR_ELIGIBLE" : "EVIDENCE_PENDING",
    diagnosis,
    intentGate: semantic,
    orchestrator: next,
    evidenceChain: er.chain
  };
  append({ type: "REPRODUCTION", at: now(), jobId: job.id, evidence: er.record, job: updated });
  append({ type: "STATE", at: now(), jobId: job.id, job: updated });
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

function proposeRepair(job, proposal = {}) {
  if (!job) {
    const error = new Error("job_not_found");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  if (!job.orchestrator) throw new Error("ORCHESTRATOR_JOB_MISSING");
  const semantic = intent.analyze({
    intent: proposal.intent,
    changedFiles: proposal.changedFiles || job.orchestrator.changedFiles || job.changedFiles
  });
  if (semantic.decision !== "ALLOW") {
    const blockedJob = orchestrator.nextState(job.orchestrator, "CRITIC_BLOCKED", { intentGate: semantic });
    const er = evidence.append(job.evidenceChain, {
      type: "intent_gate",
      intent: proposal.intent || "missing",
      action: "semantic_scope_check",
      decision: "BLOCK",
      evidence: semantic
    });
    const updatedBlocked = {...job, updatedAt: now(), orchestrator: blockedJob, intentGate: semantic, evidenceChain: er.chain};
    append({ type: "STATE", at: now(), jobId: job.id, job: updatedBlocked });
    return updatedBlocked;
  }
  const result = orchestrator.evaluateRepair(job.orchestrator, proposal);
  let updated = {...job, updatedAt: now(), orchestrator: result.job, intentGate: semantic};
  const er = evidence.append(updated.evidenceChain, { type: "repair_proposal", intent: "repair_ci_failure", action: "propose_repair", decision: result.job.state === "SANDBOX_REQUIRED" ? "ALLOW_SANDBOX" : "BLOCK", evidence: result.evaluation });
  updated = {...updated, evidenceChain: er.chain};
  append({ type: "STATE", at: now(), jobId: job.id, job: updated });
  return updated;
}

function recordSandbox(job, result) {
  if (!job) throw new Error("job_not_found");
  if (!job.orchestrator) throw new Error("ORCHESTRATOR_JOB_MISSING");
  const state = orchestrator.recordSandbox(job.orchestrator, result);
  let updated = {...job, updatedAt: now(), orchestrator: state};
  const er = evidence.append(updated.evidenceChain, { type: "sandbox_result", intent: "verify_repair", action: "sandbox_execute", decision: result?.passed === true ? "ALLOW_CI" : "BLOCK_OR_RETRY", evidence: result });
  updated = {...updated, evidenceChain: er.chain};
  append({ type: "STATE", at: now(), jobId: job.id, job: updated });
  return updated;
}

function recordCI(job, result) {
  if (!job) throw new Error("job_not_found");
  if (!job.orchestrator) throw new Error("ORCHESTRATOR_JOB_MISSING");
  const state = orchestrator.recordCI(job.orchestrator, result);
  let updated = {...job, updatedAt: now(), orchestrator: state};
  const er = evidence.append(updated.evidenceChain, { type: "ci_result", intent: "verify_repair", action: "ci_validate", decision: result?.conclusion === "success" ? "ALLOW_PROOF" : "BLOCK_OR_RETRY", evidence: result });
  updated = {...updated, evidenceChain: er.chain};
  append({ type: "STATE", at: now(), jobId: job.id, job: updated });
  return updated;
}

function finalizeProof(job, options = {}) {
  if (!job) throw new Error("job_not_found");
  if (!job.orchestrator) throw new Error("ORCHESTRATOR_JOB_MISSING");
  const result = orchestrator.finalizeProof(job.orchestrator, options);
  const er = evidence.append(job.evidenceChain, { type: "proof_receipt", intent: "release_verified_repair", action: "finalize_proof", decision: "READY_FOR_REVIEW", evidence: result.receipt });
  const issuedApproval = approval.createApproval({
    jobId: job.id,
    resource: job.resource,
    headSha: result.receipt.after?.sha || result.receipt.before?.sha,
    policyVersion: result.receipt.policy,
    evidenceHeadHash: er.chain.headHash,
    decision: "READY_FOR_REVIEW"
  });
  const updated = {...job, updatedAt: now(), orchestrator: result.job, evidenceChain: er.chain, approval: issuedApproval};
  append({ type: "PROOF", at: now(), jobId: job.id, receipt: result.receipt, evidence: er.record });
  append({ type: "STATE", at: now(), jobId: job.id, job: updated });
  return {job: updated, receipt: result.receipt};
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
  proposeRepair,
  recordSandbox,
  recordCI,
  finalizeProof,
  reproduceRepair,
  health,
  classifyFailure
};
