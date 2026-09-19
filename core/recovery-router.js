"use strict";

const { Router } = require("express");
const { enqueue, list, update } = require("./recovery-store");
const { fingerprint, decide } = require("./kill-critic");
const { buildPatchProposal } = require("./interop/patch-proposal");
const { buildPatchCandidate } = require("./interop/patch-candidate");

const PATTERNS = [
  { type: "dependency_error", re: /(npm ERR!|module not found|could not resolve|dependency|gradle.*failed|aapt2)/i, weight: 0.30 },
  { type: "test_failure", re: /(test failed|assertionerror|failing tests|failed tests|tests? failed)/i, weight: 0.25 },
  { type: "syntax_error", re: /(syntaxerror|parse error|unexpected token)/i, weight: 0.30 },
  { type: "timeout", re: /(timed out|timeout|deadline exceeded)/i, weight: 0.25 },
  { type: "auth_error", re: /(401 unauthorized|403 forbidden|authentication failed|permission denied)/i, weight: 0.25 },
  { type: "oom", re: /(out of memory|heap out of memory|oomkilled|exit code 137)/i, weight: 0.30 },
  { type: "network_error", re: /(econnreset|enotfound|network error|connection refused|could not resolve host)/i, weight: 0.20 }
];

function normalizeWorkflowRun(payload = {}) {
  const run = payload.workflow_run || payload;
  const repo = payload.repository || {};
  const conclusion = String(run.conclusion || "unknown");
  const eventKey = `github:workflow_run:${repo.full_name || repo.id || "unknown"}:${run.id || run.run_number || "unknown"}`;
  return {
    eventKey, source: "github_workflow_run",
    repository: repo.full_name || null, workflow: run.name || null,
    runId: run.id || null, runNumber: run.run_number || null,
    conclusion, status: run.status || null, branch: run.head_branch || null,
    sha: run.head_sha || null, htmlUrl: run.html_url || null,
    sender: payload.sender?.login || null
  };
}

function diagnose(logs = "") {
  const text = String(logs || "");
  const matches = PATTERNS.filter(x => x.re.test(text));
  const primary = matches.sort((a,b) => b.weight-a.weight)[0];
  return {
    errorType: primary?.type || "generic",
    confidence: primary ? Math.min(0.9, 0.45 + primary.weight) : 0.15,
    matches: matches.map(x => x.type),
    evidence: {
      exactErrorMatch: primary ? 0.8 : 0,
      stackTraceMatch: /(at\s+\S+|Exception|Traceback)/i.test(text) ? 0.7 : 0,
      changedFileMatch: 0,
      dependencyMatch: matches.some(x => x.type === "dependency_error") ? 0.9 : 0,
      historicalMatch: 0,
      scopeMatch: 1,
      sandboxPass: false,
      regressionPass: false
    }
  };
}

function isBoundToJob(current, proposalInput = {}) {
  const expected = String(current?.fingerprint || "").trim().toLowerCase();
  const supplied = String(proposalInput?.evidenceFingerprint || "").trim().toLowerCase();
  return Boolean(expected && /^[a-f0-9]{24}$/.test(expected) && supplied === expected);
}

function createRecoveryRouter({ requireRecoveryAuth }) {
  const router = Router();

  router.post("/github", requireRecoveryAuth, (req, res) => {
    try {
      const job = normalizeWorkflowRun(req.body || {});
      if (!job.runId && !job.runNumber) return res.status(400).json({ ok:false, error:{ code:"INVALID_WORKFLOW_RUN", message:"workflow_run.id is required" } });

      const failures = ["failure","timed_out","cancelled","startup_failure","action_required"];
      if (!failures.includes(job.conclusion)) return res.status(202).json({ ok:true, accepted:false, reason:"not_recoverable_failure", job });

      const logs = String(req.body?.failure_logs || "");
      const diagnosis = diagnose(logs);
      const fp = fingerprint({
        workflow: job.workflow, job: job.runId, step: job.branch, exitCode: 1,
        errorType: diagnosis.errorType, errorMessage: logs.slice(-12000), command: job.sha
      });
      const result = enqueue({ ...job, fingerprint: fp, diagnosis });
      const critic = decide({
        attempts: result.job.attempts,
        evidence: diagnosis.evidence,
        patch: { changedFiles: 0, changedLines: 0 }
      });
      const saved = result.created
        ? update(result.job.id, { diagnosis, critic, status: critic.action === "SANDBOX" ? "ready_for_patch" : "queued" })
        : result.job;

      return res.status(result.created ? 202 : 200).json({ ok:true, accepted:true, created:result.created, job:saved, critic });
    } catch (error) {
      return res.status(500).json({ ok:false, error:{ code:"RECOVERY_ENQUEUE_FAILED", message:error.message } });
    }
  });

  router.post("/jobs/:id/candidate", requireRecoveryAuth, (req, res) => {
    try {
      const current = list(100).find(x => x.id === req.params.id);
      if (!current) return res.status(404).json({ ok:false, error:{ code:"RECOVERY_JOB_NOT_FOUND", message:"recovery job not found" } });
      if (!["ready_for_patch","queued"].includes(current.status)) {
        return res.status(409).json({ ok:false, error:{ code:"INVALID_RECOVERY_STATE", message:"job is not accepting a patch candidate" } });
      }
      if (!isBoundToJob(current, req.body || {})) {
        return res.status(409).json({ ok:false, error:{ code:"EVIDENCE_BINDING_MISMATCH", message:"candidate evidenceFingerprint must match the persisted job fingerprint" } });
      }

      const candidate = buildPatchCandidate(req.body || {});
      if (!candidate.accepted) {
        return res.status(422).json({ ok:false, error:{ code:"INVALID_PATCH_CANDIDATE", message:candidate.reason } });
      }

      const changedFiles = candidate.candidate.files;
      const changedLines = String(candidate.candidate.diff).split(/\r?\n/).filter(line => /^\+[^+]|^-[^-]/.test(line)).length;
      const deletions = String(candidate.candidate.diff).split(/\r?\n/).filter(line => /^-[^-]/.test(line)).length;
      const sensitivePaths = changedFiles.filter(p => /(^|\/)(\.github|\.env|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|android\/app\/src\/main\/AndroidManifest\.xml)(\/|$)/i.test(p));
      const patch = { changedFiles: changedFiles.length, changedLines, deletions, sensitivePaths };
      const evidence = { ...(current.diagnosis?.evidence || {}), scopeMatch: 1, changedFileMatch: 1, sandboxPass: false, regressionPass: false };
      const critic = decide({ attempts: current.attempts, evidence, patch });

      if (critic.action !== "SANDBOX") {
        const status = critic.action === "HUMAN_REVIEW" ? "human_review" : "stopped";
        const saved = update(current.id, { patchCandidate:candidate.candidate, patch, diagnosis:{ ...(current.diagnosis || {}), evidence }, critic, status });
        return res.status(202).json({ ok:true, job:saved, critic });
      }

      const saved = update(current.id, {
        patchProposal: candidate.candidate,
        patchCandidate: candidate.candidate,
        patch,
        diagnosis: { ...(current.diagnosis || {}), evidence },
        critic,
        status: "sandbox_pending"
      });
      return res.status(202).json({ ok:true, job:saved, critic });
    } catch (error) {
      return res.status(500).json({ ok:false, error:{ code:"PATCH_CANDIDATE_FAILED", message:error.message } });
    }
  });

  router.post("/jobs/:id/proposal", requireRecoveryAuth, (req, res) => {
    try {
      const current = list(100).find(x => x.id === req.params.id);
      if (!current) return res.status(404).json({ ok:false, error:{ code:"RECOVERY_JOB_NOT_FOUND", message:"recovery job not found" } });
      if (!["ready_for_patch","queued"].includes(current.status)) {
        return res.status(409).json({ ok:false, error:{ code:"INVALID_RECOVERY_STATE", message:"job is not accepting a patch proposal" } });
      }

      // Bind the proposal to the exact failure evidence that created this job.
      // A caller cannot present evidence from a different incident as proof for this repair.
      if (!isBoundToJob(current, req.body || {})) {
        return res.status(409).json({
          ok:false,
          error:{
            code:"EVIDENCE_BINDING_MISMATCH",
            message:"proposal evidenceFingerprint must match the persisted job fingerprint"
          }
        });
      }

      const proposal = buildPatchProposal(req.body || {});
      if (!proposal.accepted) return res.status(422).json({ ok:false, error:{ code:"INVALID_PATCH_PROPOSAL", message:proposal.reason } });

      const changedFiles = proposal.proposal.files;
      const changedLines = String(proposal.proposal.diff).split(/\r?\n/).filter(line => /^\+[^+]|^-[^-]/.test(line)).length;
      const deletions = String(proposal.proposal.diff).split(/\r?\n/).filter(line => /^-[^-]/.test(line)).length;
      const sensitivePaths = changedFiles.filter(p => /(^|\/)(\.github|\.env|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|android\/app\/src\/main\/AndroidManifest\.xml)(\/|$)/i.test(p));
      const patch = { changedFiles: changedFiles.length, changedLines, deletions, sensitivePaths };
      const evidence = { ...(current.diagnosis?.evidence || {}), scopeMatch: 1, changedFileMatch: 1 };
      const critic = decide({ attempts: current.attempts, evidence, patch });

      const saved = update(current.id, {
        patchProposal: proposal.proposal,
        patch,
        diagnosis: { ...(current.diagnosis || {}), evidence },
        critic,
        status: critic.action === "SANDBOX" ? "sandbox_pending" : critic.action === "HUMAN_REVIEW" ? "human_review" : "stopped"
      });

      return res.status(202).json({ ok:true, job:saved, critic });
    } catch (error) {
      return res.status(500).json({ ok:false, error:{ code:"PATCH_PROPOSAL_FAILED", message:error.message } });
    }
  });

  router.get("/jobs", requireRecoveryAuth, (_req,res) => res.json({ ok:true, jobs:list(100) }));
  return router;
}

module.exports = { createRecoveryRouter, normalizeWorkflowRun, diagnose, isBoundToJob };
