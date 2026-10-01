"use strict";

const crypto = require("crypto");
const store = require("./store");
const { policyFor } = require("./control-plane");
const sandbox = require("./sandbox");

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function create(input) {
  return store.createIncident({
    ...input,
    failure_fingerprint: input.failure_fingerprint || fingerprint({
      repository: input.repository,
      commit_sha: input.commit_sha,
      failure: input.failure
    })
  });
}

function attachProposal(incidentId, proposal) {
  const incident = store.getIncident(incidentId);
  if (!incident) throw new Error("incident_not_found");

  const result = store.transition(
    incidentId,
    "POLICY_CHECKING",
    "AIProposer",
    "candidate_patch_received",
    { proposal }
  );
  if (result.decision !== "ALLOW") throw new Error(result.reason);
  return result.incident;
}

function authorizeSandbox(incidentId) {
  const incident = store.getIncident(incidentId);
  if (!incident) throw new Error("incident_not_found");

  const policy = policyFor({
    risk: incident.risk,
    repository: incident.repository
  });

  if (!policy.autonomous_execution) {
    return store.transition(
      incidentId,
      "HUMAN_APPROVAL_REQUIRED",
      "PolicyEngine",
      "autonomous_execution_denied"
    );
  }

  return store.transition(
    incidentId,
    "SANDBOX_PENDING",
    "PolicyEngine",
    "sandbox_authorized"
  );
}

async function runSandbox(incidentId, input) {
  const incident = store.getIncident(incidentId);
  if (!incident) throw new Error("incident_not_found");
  if (store.isKilled()) throw new Error("kill_switch_active");
  if (incident.state !== "SANDBOX_PENDING") throw new Error("sandbox_not_pending");
  if (!incident.proposal?.diff) throw new Error("proposal_diff_required");

  const running = store.transition(
    incidentId,
    "SANDBOX_RUNNING",
    "SandboxDispatcher",
    "sandbox_started"
  );
  if (running.decision !== "ALLOW") throw new Error(running.reason);

  let workspace;
  try {
    workspace = await sandbox.prepareWorkspace({
      repositoryPath: input.repositoryPath,
      commitSha: incident.commit_sha,
      patch: incident.proposal.diff
    });

    const result = await sandbox.execute({
      workspace,
      command: input.command,
      image: input.image
    });

    const next = result.status === "PASSED"
      ? "CRITIC_EVALUATION"
      : "FAILED_RECOVERY";

    const updated = store.transition(
      incidentId,
      next,
      "Sandbox",
      result.status === "PASSED" ? "sandbox_verified" : "sandbox_failed",
      { sandbox: result }
    );

    return updated.incident || updated;
  } finally {
    sandbox.cleanupWorkspace(workspace);
  }
}

function evaluateCritics(incidentId, critics) {
  const incident = store.getIncident(incidentId);
  if (!incident) throw new Error("incident_not_found");
  if (incident.state !== "CRITIC_EVALUATION") throw new Error("critic_evaluation_not_pending");

  const verdicts = critics || {};
  const blocked = Object.values(verdicts).some(v => v && v.pass === false);

  if (blocked) {
    return store.transition(
      incidentId,
      "REJECTED",
      "CriticsEngine",
      "critic_rejected_candidate",
      { critics: verdicts }
    );
  }

  const proof = {
    schema: "samurai-x10-proof/v1",
    incident_id: incidentId,
    sandbox_run_id: incident.sandbox?.run_id || null,
    critics: verdicts,
    policy_version: incident.policy?.policy_version,
    generated_at: new Date().toISOString()
  };
  proof.proof_hash = fingerprint(proof);

  return store.transition(
    incidentId,
    "PROOF_GENERATION",
    "CriticsEngine",
    "all_critics_passed",
    { critics: verdicts, proof }
  );
}

function finalizeProof(incidentId) {
  const incident = store.getIncident(incidentId);
  if (!incident) throw new Error("incident_not_found");
  if (incident.state !== "PROOF_GENERATION") throw new Error("proof_not_pending");

  return store.transition(
    incidentId,
    "HUMAN_APPROVAL_REQUIRED",
    "ProofLedger",
    "proof_generated_human_review_required"
  );
}

module.exports = {
  create,
  attachProposal,
  authorizeSandbox,
  runSandbox,
  evaluateCritics,
  finalizeProof
};
