"use strict";

const { Router } = require("express");
const { enqueue, list } = require("./recovery-store");
const { decide } = require("./kill-critic");

function normalizeWorkflowRun(payload = {}) {
  const run = payload.workflow_run || payload;
  const repo = payload.repository || {};
  const conclusion = String(run.conclusion || "unknown");
  const eventKey = `github:workflow_run:${repo.full_name || repo.id || "unknown"}:${run.id || run.run_number || "unknown"}`;
  return {
    eventKey,
    source: "github_workflow_run",
    repository: repo.full_name || null,
    workflow: run.name || null,
    runId: run.id || null,
    runNumber: run.run_number || null,
    conclusion,
    status: run.status || null,
    branch: run.head_branch || null,
    sha: run.head_sha || null,
    htmlUrl: run.html_url || null,
    sender: payload.sender?.login || null,
    raw: {
      conclusion,
      status: run.status || null,
      name: run.name || null,
      headBranch: run.head_branch || null,
      headSha: run.head_sha || null
    }
  };
}

function createRecoveryRouter({ requireRecoveryAuth, recoveryApiKey }) {
  const router = Router();

  router.post("/github", requireRecoveryAuth, (req, res) => {
    try {
      const job = normalizeWorkflowRun(req.body || {});
      if (!job.runId && !job.runNumber) {
        return res.status(400).json({ ok: false, error: { code: "INVALID_WORKFLOW_RUN", message: "workflow_run.id is required" } });
      }

      const isFailure = ["failure", "timed_out", "cancelled", "startup_failure", "action_required"].includes(job.conclusion);
      if (!isFailure) {
        return res.status(202).json({ ok: true, accepted: false, reason: "not_recoverable_failure", job });
      }

      const result = enqueue(job);
      const decision = decide({
        attempts: result.job.attempts,
        evidence: {},
        patch: {}
      });

      return res.status(result.created ? 202 : 200).json({
        ok: true,
        accepted: true,
        created: result.created,
        job: result.job,
        critic: decision
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: { code: "RECOVERY_ENQUEUE_FAILED", message: error.message } });
    }
  });

  router.get("/jobs", requireRecoveryAuth, (_req, res) => {
    res.json({ ok: true, jobs: list(100) });
  });

  return router;
}

module.exports = { createRecoveryRouter, normalizeWorkflowRun };
