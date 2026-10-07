"use strict";

const crypto = require("node:crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createApproval({jobId, resource, headSha, policyVersion, evidenceHeadHash, decision = "READY_FOR_REVIEW"} = {}) {
  if (!jobId || !resource || !headSha || !policyVersion || !evidenceHeadHash) {
    const error = new Error("APPROVAL_BINDING_INCOMPLETE");
    error.code = "APPROVAL_BINDING_INCOMPLETE";
    throw error;
  }
  const approval = {
    schema: "x10think-approval/v1",
    approvalId: "ap_" + crypto.randomUUID(),
    jobId: String(jobId),
    resource: String(resource),
    headSha: String(headSha),
    policyVersion: String(policyVersion),
    evidenceHeadHash: String(evidenceHeadHash),
    decision: String(decision),
    issuedAt: new Date().toISOString()
  };
  return {...approval, approvalHash: sha256(JSON.stringify(approval))};
}

function reassess(approval, current = {}) {
  if (!approval || approval.schema !== "x10think-approval/v1") {
    return {valid: false, invalidated: true, reasons: ["approval_invalid"]};
  }
  const reasons = [];
  if (!current.headSha || String(current.headSha) !== approval.headSha) reasons.push("head_sha_changed");
  if (!current.policyVersion || String(current.policyVersion) !== approval.policyVersion) reasons.push("policy_version_changed");
  if (!current.evidenceHeadHash || String(current.evidenceHeadHash) !== approval.evidenceHeadHash) reasons.push("evidence_context_changed");
  return {
    valid: reasons.length === 0,
    invalidated: reasons.length > 0,
    reasons,
    approvalHash: approval.approvalHash
  };
}

module.exports = { createApproval, reassess };
