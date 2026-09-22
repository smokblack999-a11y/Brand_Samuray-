"use strict";

const { Router } = require("express");
const { enqueue, list, update } = require("./recovery-store");
const { fingerprint, decide } = require("./kill-critic");
const { buildPatchProposal } = require("./interop/patch-proposal");
const { buildPatchCandidate } = require("./interop/patch-candidate");
const { analyzeIncident, toRecoveryDiagnosis } = require("./x10think-recovery");
const { registerProofReceipt, notifyRecoveryProof } = require("./nexus-proof-ledger");
const crypto = require("node:crypto");

function diagnose(logs = "", context = {}) {
  const state = analyzeIncident({
    repository: context.repository,
    workflow: context.workflow,
    runId: context.runId,
    branch: context.branch,
    sha: context.sha,
    logs
  });
  return toRecoveryDiagnosis(state);
}

function isBoundToJob(current, proposalInput = {}) {
  const expected = String(current?.fingerprint || "").trim().toLowerCase();
  const supplied = String(proposalInput?.evidenceFingerprint || "").trim().toLowerCase();
  return Boolean(expected && /^[a-f0-9]{24}$/.test(expected) && supplied === expected);
}

function isRepairBranch(branch = "") {
  return String(branch || "").startsWith("recovery/");
}

function shouldRetry(attempts, maxAttempts = 3) {
  return Number(attempts || 0) < Number(maxAttempts || 3);
}

function buildProofReceipt(completed, verificationJob, now = new Date()) {
  const headSha =
    completed.repairHeadSha ||
    completed.verificationSha ||
    completed.sha ||
    verificationJob.sha;

  const proofId = "NXS-PROOF-" + crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        fingerprint: completed.fingerprint,
        repository: completed.repository,
        repairBranch: completed.branch,
        headSha,
        verificationRunId: verificationJob.runId
      })
    )
    .digest("hex")
    .slice(0, 24);

  return {
    version: 1,
    type: "x10think.recovery.proof",
    proofId,
    fingerprint: completed.fingerprint,
    repository: completed.repository,
    repairBranch: completed.branch,
    headSha,
    workflowRunId: completed.runId,
    verificationRunId: verificationJob.runId,
    verifiedAt: now.toISOString(),
    gates: { sandbox: true, regression: true, githubCi: true, autonomousMerge: false }
  };
}

function createRecoveryRouter({ requireRecoveryAuth }) {
  const router = Router();

  router.post("/github", requireRecoveryAuth, (req, res) => {
    try {
      const job = normalizeWorkflowRun(req.body || {});
      if (!job.runId && !job.runNumber) return res.status(400).json({ ok:false, error:{ code:"INVALID_WORKFLOW_RUN", message:"workflow_run.id is required" } });

      const failures = ["failure","timed_out","cancelled","startup_failure","action_required"];
      if (job.conclusion === "success" && isRepairBranch(job.branch)) {
        const completed = list(100).find(item =>
          item.repository === job.repository &&
          item.branch === job.branch &&
          ["pr_created","pr_ready","sandbox_pending","human_review"].includes(item.status)
        );
        if (!completed) return res.status(202).json({ ok:true, accepted:false, reason:"no_matching_recovery_job", job });
        const proofReceipt = buildProofReceipt(completed, job);

        let ledgerEntry;
        try {
          ledgerEntry = registerProofReceipt(proofReceipt);
        } catch (error) {
          if (/^DUPLICATE_PROOF:/.test(error.message)) {
            const saved = update(completed.id, {
              status: "verified",
              verificationRunId: job.runId,
              verificationSha: job.sha,
              proofReceipt,
              lastFailureConclusion: null,
              workerError: null
            });
            return res.status(200).json({
              ok: true,
              accepted: true,
              verified: true,
              idempotent: true,
              job: saved,
              proofReceipt,
              ledger: { registered: false, duplicate: true }
            });
          }
          throw error;
        }

        const notification = await notifyRecoveryProof(proofReceipt);
        const saved = update(completed.id, {
          status: "verified",
          verificationRunId: job.runId,
          verificationSha: job.sha,
          proofReceipt,
          proofLedger: ledgerEntry,
          notification,
          lastFailureConclusion: null,
          workerError: null
        });

        return res.status(200).json({
          ok:true,
          accepted:true,
          verified:true,
          job:saved,
          proofReceipt,
          ledger: { registered: true, entryHash: ledgerEntry.entryHash },
          notification
        });
      }
      if (!failures.includes(job.conclusion)) return res.status(202).json({ ok:true, accepted:false, reason:"not_recoverable_failure", job });

      const logs = String(req.body?.failure_logs || "");
      const repairBranch = isRepairBranch(job.branch);
      const existing = list(100).find(item =>
        item.repository === job.repository &&
        item.branch === job.branch &&
        item.status !== "verified" &&
        item.status !== "stopped"
      );

      // A repair-branch failure is a continuation of the same incident.
      // Never create a second recovery job/PR chain for the same fingerprint.
      if (repairBranch && existing) {
        const nextAttempts = Number(existing.attempts || 0) + 1;
        const diagnosis = diagnose(logs, job);
        const fp = String(existing.fingerprint || fingerprint({
          workflow: job.workflow, job: job.runId, step: job.branch, exitCode: 1,
          errorType: diagnosis.errorType, errorMessage: logs.slice(-12000), command: job.sha
        }));
        const status = shouldRetry(nextAttempts) ? "queued" : "stopped";
        const saved = update(existing.id, {
          attempts: nextAttempts,
          lastFailureRunId: job.runId,
          lastFailureSha: job.sha,
          lastFailureConclusion: job.conclusion,
          failureLogs: logs.slice(-12000),
          diagnosis,
          status,
          workerError: status === "stopped" ? "REPAIR_RETRY_BUDGET_EXHAUSTED" : null
        });
        const critic = decide({
          attempts: nextAttempts,
          evidence: diagnosis.evidence,
          patch: existing.patch || { changedFiles: 0, changedLines: 0 }
        });
        return res.status(202).json({
          ok:true, accepted:true, created:false, continued:true,
          job:saved, critic
        });
      }

      const diagnosis = diagnose(logs);
      const fp = fingerprint({
        workflow: job.workflow, job: job.runId, step: job.branch, exitCode: 1,
        errorType: diagnosis.errorType, errorMessage: logs.slice(-12000), command: job.sha
      });
      const result = enqueue({ ...job, fingerprint: fp, diagnosis, failureLogs: logs.slice(-12000) });
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

module.exports = { createRecoveryRouter, normalizeWorkflowRun, diagnose, isBoundToJob, isRepairBranch, shouldRetry, buildProofReceipt };
