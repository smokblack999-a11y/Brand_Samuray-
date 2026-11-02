"use strict";

const crypto = require("node:crypto");

function createRepairProposal({ finding, evidence, suggestedPatch, risk = "medium" }) {
  if (!finding || typeof finding !== "string" || finding.length > 4000) throw new Error("finding_required");
  if (!evidence || typeof evidence.id !== "string" || !evidence.id) throw new Error("evidence_required");
  if (!["low", "medium", "high", "critical"].includes(risk)) throw new Error("invalid_risk");
  const patch = String(suggestedPatch || "");
  if (patch.length > 20000) throw new Error("patch_too_large");
  return Object.freeze({
    id: crypto.randomUUID(),
    status: "PROPOSED",
    requiresHumanApproval: true,
    autoApply: false,
    finding,
    evidence: { id: evidence.id, source: String(evidence.source || "unspecified"), observedAt: evidence.observedAt || null },
    suggestedPatch: patch,
    risk,
    createdAt: new Date().toISOString()
  });
}
function approveProposal(proposal, actor) {
  if (!proposal || proposal.status !== "PROPOSED") throw new Error("proposal_not_pending");
  if (!actor || typeof actor.id !== "string" || !actor.id) throw new Error("approver_required");
  return { ...proposal, status: "APPROVED_FOR_REVIEW", approvedBy: actor.id, approvedAt: new Date().toISOString(), applied: false };
}
module.exports = { createRepairProposal, approveProposal };
