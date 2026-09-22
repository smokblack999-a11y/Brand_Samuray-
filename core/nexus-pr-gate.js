"use strict";

const { sha256, canonicalJson } = require("./nexus-proof-receipt");

function assertBranch(value, name) {
  const branch = String(value || "").trim();
  if (!branch || branch.length > 255 || /[\u0000\n\r]/.test(branch)) throw new Error(name + " is required and must be a valid branch name");
  return branch;
}

function validateShipReceipt(receipt, { headSha } = {}) {
  if (!receipt || typeof receipt !== "object") throw new Error("receipt is required");
  if (receipt.decision !== "SHIP" || receipt.humanRequired !== false) throw new Error("only a verified SHIP receipt can create a draft PR");
  if (receipt.risk !== "LOW") throw new Error("only LOW-risk receipts can create a draft PR");
  if (!/^NXS-[a-f0-9]{24}$/.test(String(receipt.proofId || ""))) throw new Error("receipt proofId is invalid");
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptHash || ""))) throw new Error("receipt hash is invalid");
  if (headSha && String(receipt.patchSha) !== String(headSha)) throw new Error("receipt patch SHA does not match PR head SHA");
  return true;
}

function buildProofPrBody({ receipt, summary = "", evidenceUrl = "" } = {}) {
  validateShipReceipt(receipt);
  const proofHash = sha256(canonicalJson(receipt));
  const evidenceLine = evidenceUrl ? "Evidence: " + String(evidenceUrl) : "Evidence: embedded Proof Receipt";
  return [
    "## NEXUS Proof-to-Ship", "",
    String(summary || "Verified low-risk patch candidate."), "",
    "### Verification",
    "- Decision: SHIP",
    "- Proof ID: " + receipt.proofId,
    "- Receipt hash: " + receipt.receiptHash,
    "- Recomputed receipt hash: " + proofHash,
    "- Patch SHA: " + receipt.patchSha,
    "- Risk: " + receipt.risk,
    "- " + evidenceLine, "",
    "### Safety boundary",
    "- Draft PR only.",
    "- No autonomous merge or deployment.",
    "- Human review remains the final authority for repository policy.", "",
    "### Proof Receipt",
    JSON.stringify(receipt, null, 2)
  ].join("\n");
}

async function createVerifiedDraftPr({ githubClient, repository, head, headSha, base = "main", title = "NEXUS: verified repair", summary = "", receipt, evidenceUrl = "" } = {}) {
  if (!githubClient || typeof githubClient.createPullRequest !== "function") throw new Error("githubClient.createPullRequest is required");
  if (!repository) throw new Error("repository is required");
  const headBranch = assertBranch(head, "head");
  const baseBranch = assertBranch(base, "base");
  validateShipReceipt(receipt, { headSha });
  return githubClient.createPullRequest({
    repository_full_name: String(repository),
    title: String(title).trim() || "NEXUS: verified repair",
    body: buildProofPrBody({ receipt, summary, evidenceUrl }),
    head: headBranch,
    base: baseBranch,
    draft: true,
    maintainer_can_modify: false
  });
}

module.exports = { validateShipReceipt, buildProofPrBody, createVerifiedDraftPr };
