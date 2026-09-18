"use strict";

const { diagnose } = require("./diagnoser");
const { buildRepairPlan } = require("./repair-plan");
const { buildPatchCandidate } = require("./patch-candidate");
const { buildPatchProposal } = require("./patch-proposal");
const { proposePatch: proposePatchWithOpenAI } = require("./openai-patch-proposer");
const { buildReproductionPlan } = require("./reproduction-gate");
const { runReproduction } = require("./reproduction-runner");
const { provisionWorkspace } = require("./workspace-provisioner");
const { readSourceContext, formatSourceContext } = require("./source-context");
const { claimNext, transition } = require("./store");

function criticReview(evidence, reproductionProof = null) {
  const integrity = evidence?.evidenceOnly === true && evidence?.credentialsRedacted === true;
  const concreteEvidence = evidence?.confidence === "high" && Array.isArray(evidence?.failedJobs) && evidence.failedJobs.some(job => job?.evidence?.excerpts?.length > 0);
  const proof = reproductionProof || {};
  const reproduction = proof.reproduction === true;
  const causality = proof.causality === true;
  const security = integrity;
  return {
    passed: false,
    readyForPatchCandidate: Boolean(integrity && concreteEvidence && reproduction && causality),
    gates: { evidenceIntegrity: integrity, concreteEvidence, reproduction, causality, minimalPatch: false, regression: false, security },
    rule: "kill-critic-v2"
  };
}

async function processJob(job, deps = {}) {
  if (!job) return null;
  const runDiagnose = deps.diagnose || diagnose;
  const makeRepairPlan = deps.buildRepairPlan || buildRepairPlan;
  const makePatchCandidate = deps.buildPatchCandidate || buildPatchCandidate;
  const makePatchProposal = deps.buildPatchProposal || buildPatchProposal;
  const proposePatch = deps.proposePatch || proposePatchWithOpenAI;
  const makeReproductionPlan = deps.buildReproductionPlan || buildReproductionPlan;
  const executeReproduction = deps.runReproduction || runReproduction;
  const provision = deps.provisionWorkspace || provisionWorkspace;
  const move = deps.transition || transition;

  if (!job.workflowRunId) {
    return move(job.id, "HUMAN_REVIEW", { reason: "MISSING_WORKFLOW_RUN_ID" });
  }
  if (!job.commit || !/^[0-9a-f]{40}$/i.test(String(job.commit))) {
    return move(job.id, "HUMAN_REVIEW", { reason: "MISSING_EXACT_COMMIT_SHA" });
  }

  move(job.id, "DIAGNOSING");
  let provisioned = null;
  try {
    const evidence = await runDiagnose(job, deps);
    if (!evidence || !evidence.failedJobs?.length) {
      return move(job.id, "HUMAN_REVIEW", { reason: "INSUFFICIENT_FAILURE_EVIDENCE", evidence: evidence || null });
    }
    if (evidence.evidenceOnly !== true || !evidence.workflowRunId) {
      return move(job.id, "STOPPED", { reason: "INVALID_EVIDENCE" });
    }

    const proposalInput = deps.patch ? {
      evidenceOnly: evidence.evidenceOnly,
      diff: deps.patch,
      changedFiles: job.changedFiles || [],
      source: deps.patchSource || "worker-input"
    } : null;

    if (!proposalInput && !deps.workspace) {
      provisioned = await provision({
        repository: job.repository,
        headSha: job.commit,
        githubToken: deps.githubToken,
        timeoutMs: deps.workspaceTimeoutMs
      });
    }

    let sourceContext = deps.sourceContext || "";
    const sourceWorkspace = deps.workspace || provisioned?.workspace;
    if (!sourceContext && sourceWorkspace && job.changedFiles?.length) {
      sourceContext = formatSourceContext(await readSourceContext(sourceWorkspace, job.changedFiles));
    }

    const proposal = proposalInput
      ? makePatchProposal(proposalInput)
      : await proposePatch({
        evidence,
        changedFiles: job.changedFiles || [],
        repository: job.repository,
        commit: job.commit,
        source: sourceContext,
        apiKey: deps.openaiApiKey
      });
    if (!proposal?.accepted || !proposal?.proposal?.diff) {
      return move(job.id, "HUMAN_REVIEW", { reason: proposal?.reason || "PATCH_PROPOSAL_REJECTED", evidence, proposal });
    }

    const reproductionPlan = makeReproductionPlan(evidence, deps.reproductionCommand);
    let reproductionProof = null;
    const patch = proposal.proposal.diff;

    if (patch) {
      if (deps.workspace) {
        if (!sourceContext && job.changedFiles?.length) {
          sourceContext = formatSourceContext(await readSourceContext(provisioned.workspace, job.changedFiles));
        }
        reproductionProof = await executeReproduction({
          workspace: deps.workspace,
          plan: reproductionPlan,
          patch,
          timeoutMs: deps.reproductionTimeoutMs
        });
      } else {
        provisioned = await provision({
          repository: job.repository,
          headSha: job.commit,
          githubToken: deps.githubToken,
          timeoutMs: deps.workspaceTimeoutMs
        });
        reproductionProof = await executeReproduction({
          workspace: provisioned.workspace,
          plan: reproductionPlan,
          patch,
          timeoutMs: deps.reproductionTimeoutMs
        });
      }
    }

    const critic = criticReview(evidence, reproductionProof);
    const verifiedEvidence = reproductionProof
      ? { ...evidence, reproduction: reproductionProof.reproduction === true, causality: reproductionProof.causality === true }
      : evidence;
    const repairPlan = makeRepairPlan(verifiedEvidence);
    const patchCandidate = makePatchCandidate(verifiedEvidence, job.changedFiles || []);
    return move(job.id, "CRITIC_REVIEW", { diagnosis: verifiedEvidence, reproductionPlan, reproductionProof, critic, repairPlan, patchCandidate });
  } catch (error) {
    const message = String(error?.message || error);
    if (/OPENAI_API_KEY is required/.test(message)) {
      return move(job.id, "HUMAN_REVIEW", { reason: "PATCH_PROVIDER_AUTH_NOT_CONFIGURED" });
    }
    if (/GITHUB_TOKEN is required/.test(message)) {
      return move(job.id, "HUMAN_REVIEW", { reason: "GITHUB_AUTH_NOT_CONFIGURED" });
    }
    if (/exact 40-character|MISSING|workspace HEAD/.test(message)) {
      return move(job.id, "HUMAN_REVIEW", { reason: "WORKSPACE_PROVISION_ERROR", error: message.slice(0, 300) });
    }
    return move(job.id, "HUMAN_REVIEW", { reason: "DIAGNOSIS_ERROR", error: message.slice(0, 300) });
  } finally {
    if (provisioned?.cleanup) await provisioned.cleanup().catch(() => {});
  }
}

async function runOnce(deps = {}) {
  const job = (deps.claimNext || claimNext)();
  if (!job) return null;
  return processJob(job, deps);
}

async function runForever(deps = {}) {
  const intervalMs = Math.max(250, Number(deps.intervalMs || process.env.INTEROP_WORKER_INTERVAL_MS || 1000));
  while (true) {
    await runOnce(deps);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

if (require.main === module) {
  if (process.env.INTEROP_WORKER_ENABLED !== "true") {
    console.error("INTEROP_WORKER_ENABLED=true is required");
    process.exitCode = 1;
  } else {
    runForever().catch(error => {
      console.error("interop worker fatal:", error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { processJob, runOnce, runForever, criticReview };
