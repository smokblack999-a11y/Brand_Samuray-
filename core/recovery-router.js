"use strict";

const { Router } = require("express");
const { enqueue, find, list, update } = require("./recovery-store");
const { analyzePatch, sha256, DEFAULT_POLICY } = require("./x10thinc/kill-critic");
const { transition, STATES } = require("./x10thinc/recovery-state");
const { getVerification } = require("./recovery-verification");
const { buildPatchProposal } = require("./interop/patch-proposal");

const FAILURE_CONCLUSIONS = new Set(["failure","timed_out","cancelled","startup_failure","action_required"]);

function normalizeWorkflowRun(payload = {}) {
  const run = payload.workflow_run || payload;
  const repo = payload.repository || {};
  return {
    eventKey: `github:workflow_run:${repo.full_name || repo.id || "unknown"}:${run.id || run.run_number || "unknown"}`,
    repository: repo.full_name || null,
    workflow: run.name || null,
    runId: run.id || null,
    runNumber: run.run_number || null,
    conclusion: String(run.conclusion || "unknown"),
    status: run.status || null,
    branch: run.head_branch || null,
    sha: run.head_sha || null,
    htmlUrl: run.html_url || null
  };
}

function diagnose(logs = "") {
  const text = String(logs || "");
  const rules = [
    ["dependency_error", /(npm ERR!|module not found|could not resolve|dependency|gradle.*failed|aapt2)/i, .30],
    ["test_failure", /(test failed|assertionerror|failing tests|failed tests)/i, .25],
    ["syntax_error", /(syntaxerror|parse error|unexpected token)/i, .30],
    ["timeout", /(timed out|timeout|deadline exceeded)/i, .25],
    ["auth_error", /(401 unauthorized|403 forbidden|authentication failed|permission denied)/i, .25],
    ["oom", /(out of memory|heap out of memory|oomkilled|exit code 137)/i, .30]
  ];
  const matches = rules.filter(([,re]) => re.test(text)).sort((a,b) => b[2]-a[2]);
  return {
    errorType: matches[0]?.[0] || "generic",
    confidence: matches[0] ? Math.min(.9, .45 + matches[0][2]) : .15,
    matches: matches.map(x => x[0]),
    evidence: { exactErrorMatch: matches[0] ? .8 : 0, stackTraceMatch: /(at\s+\S+|Exception|Traceback)/i.test(text) ? .7 : 0, dependencyMatch: matches.some(x => x[0] === "dependency_error") ? .9 : 0, historicalMatch: 0, scopeMatch: 1 }
  };
}

function bindProof(job, proof) {
  return {
    job: {
      id: job.id,
      repository: job.repository,
      headSha: job.repairHeadSha || job.headSha,
      diffHash: job.diffHash || sha256(job.patch?.diff || "")
    },
    proof
  };
}

function createRecoveryRouter({ requireRecoveryAuth }) {
  const router = Router();

  router.get("/jobs", requireRecoveryAuth, (_req,res) => res.json({ ok:true, jobs:list(100) }));
  router.get("/jobs/:id", requireRecoveryAuth, (req,res) => {
    const job = find(req.params.id);
    if (!job) return res.status(404).json({ok:false,error:{code:"RECOVERY_JOB_NOT_FOUND"}});
    return res.json({ok:true,job});
  });

  router.post("/github", requireRecoveryAuth, (req,res) => {
    try {
      const run = normalizeWorkflowRun(req.body || {});
      if (!run.repository || !run.runId) return res.status(400).json({ok:false,error:{code:"INVALID_WORKFLOW_RUN"}});
      if (run.conclusion === "success") return res.status(202).json({ok:true,accepted:false,reason:"success_requires_recovery_verification",run});
      if (!FAILURE_CONCLUSIONS.has(run.conclusion)) return res.status(202).json({ok:true,accepted:false,reason:"not_recoverable_failure",run});
      const diagnosis = diagnose(req.body?.failure_logs || "");
      const result = enqueue({...run, diagnosis, failureLogs:req.body?.failure_logs || ""});
      const saved = result.created ? update(result.job.id, { status:"diagnosing", state:STATES.DIAGNOSING }) : result.job;
      return res.status(result.created ? 202 : 200).json({ok:true,accepted:true,created:result.created,job:saved});
    } catch (error) {
      return res.status(500).json({ok:false,error:{code:"RECOVERY_ENQUEUE_FAILED",message:error.message}});
    }
  });

  router.post("/jobs/:id/proposal", requireRecoveryAuth, (req,res) => {
    try {
      const current = find(req.params.id);
      if (!current) return res.status(404).json({ok:false,error:{code:"RECOVERY_JOB_NOT_FOUND"}});
      if (!["diagnosing","queued","patch_proposed"].includes(current.status)) return res.status(409).json({ok:false,error:{code:"INVALID_RECOVERY_STATE"}});
      const proposal = buildPatchProposal(req.body || {});
      if (!proposal.accepted) return res.status(422).json({ok:false,error:{code:"INVALID_PATCH_PROPOSAL",message:proposal.reason}});
      const diffHash = sha256(proposal.proposal.diff);
      const analyzed = analyzePatch({
        diff: proposal.proposal.diff,
        invariants: req.body?.invariants || [],
        evidence: {patch:"proposal",sandbox:"pending",tests:"pending",ci:"pending"},
        sandboxPassed:false, testsPassed:false, ciPassed:false
      });
      const preSandboxAllowed =
        analyzed.invariants.passed &&
        analyzed.risk.score < DEFAULT_POLICY.criticalRiskScore &&
        analyzed.decision !== "KILL" &&
        analyzed.risk.score < DEFAULT_POLICY.maxRiskScore;
      if (preSandboxAllowed) {
        const staged = update(current.id, {
          status:"patch_proposed", state:STATES.PATCH_PROPOSED,
          patch:proposal.proposal, diffHash, critic:analyzed.receipt
        });
        const next = update(current.id, {
          status:"sandbox_pending", state:STATES.SANDBOXED
        });
        return res.status(202).json({ok:true,job:next,critic:analyzed,stagedState:staged.state});
      }
      const next = update(current.id,{status:"human_review",state:STATES.HUMAN_REVIEW,patch:proposal.proposal,diffHash,critic:analyzed.receipt});
      return res.status(202).json({ok:true,job:next,critic:analyzed});
    } catch(error) {
      return res.status(500).json({ok:false,error:{code:"PATCH_PROPOSAL_FAILED",message:error.message}});
    }
  });

  router.post("/jobs/:id/verify", requireRecoveryAuth, async (req,res) => {
    try {
      const current = find(req.params.id);
      if (!current) return res.status(404).json({ok:false,error:{code:"RECOVERY_JOB_NOT_FOUND"}});
      const proof = req.body?.proof || {};
      const verification = await getVerification({
        repository: current.repository,
        headSha: current.repairHeadSha || current.headSha,
        workflowRunId: proof.verificationRunId
      });
      if (!verification.accepted) {
        update(current.id,{status:STATES.HUMAN_REVIEW,state:STATES.HUMAN_REVIEW,verificationError:verification.reason});
        return res.status(409).json({ok:false,code:"VERIFICATION_NOT_CONFIRMED",reason:verification.reason});
      }
      const jobForProof = {
        id: current.id, repository: current.repository,
        headSha: current.repairHeadSha || current.headSha,
        diffHash: current.diffHash || sha256(current.patch?.diff || "")
      };
      const result = transition(
        { ...jobForProof, state: current.state || STATES.PR_READY },
        STATES.VERIFIED,
        { proof }
      );
      if (!result.ok) {
        update(current.id,{status:STATES.HUMAN_REVIEW,state:STATES.HUMAN_REVIEW,verificationError:result.proof || result.code});
        return res.status(409).json({ok:false,...result});
      }
      const saved=update(current.id,{status:"verified",state:STATES.VERIFIED,proofReceipt:result.job.proofReceipt,verifiedAt:new Date().toISOString()});
      return res.status(200).json({ok:true,trusted:true,job:saved});
    } catch(error) {
      return res.status(500).json({ok:false,error:{code:"RECOVERY_VERIFY_FAILED",message:error.message}});
    }
  });

  return router;
}

module.exports={createRecoveryRouter,normalizeWorkflowRun,diagnose};