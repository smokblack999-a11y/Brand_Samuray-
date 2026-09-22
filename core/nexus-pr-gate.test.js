"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateShipReceipt, buildProofPrBody, createVerifiedDraftPr } = require("./nexus-pr-gate");

function receipt(overrides = {}) {
  return {
    proofId: "NXS-" + "a".repeat(24),
    decision: "SHIP",
    humanRequired: false,
    risk: "LOW",
    patchSha: "patch-123",
    receiptHash: "b".repeat(64),
    ...overrides
  };
}

test("accepts only a verified LOW-risk SHIP receipt", () => {
  assert.equal(validateShipReceipt(receipt(), { headSha: "patch-123" }), true);
});

test("rejects non-SHIP and higher-risk receipts", () => {
  assert.throws(() => validateShipReceipt(receipt({ decision: "BLOCKED" })), /SHIP receipt/);
  assert.throws(() => validateShipReceipt(receipt({ risk: "HIGH" })), /LOW-risk/);
});

test("rejects a receipt whose patch SHA does not match the proposed head", () => {
  assert.throws(() => validateShipReceipt(receipt(), { headSha: "different" }), /patch SHA does not match/);
});

test("PR body contains proof identity and safety boundary", () => {
  const body = buildProofPrBody({ receipt: receipt(), summary: "Fix failing test" });
  assert.match(body, /NEXUS Proof-to-Ship/);
  assert.match(body, /NXS-/);
  assert.match(body, /Draft PR only/);
  assert.match(body, /No autonomous merge or deployment/);
});

test("creates a draft PR and never requests merge", async () => {
  const calls = [];
  const githubClient = {
    createPullRequest: async (input) => {
      calls.push(input);
      return { number: 42, draft: true, head: input.head, base: input.base };
    }
  };
  const result = await createVerifiedDraftPr({
    githubClient,
    repository: "acme/app",
    head: "nexus/repair-42",
    base: "main",
    receipt: receipt(),
    summary: "Verified repair"
  });
  assert.equal(result.number, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].draft, true);
  assert.equal(calls[0].maintainer_can_modify, false);
  assert.equal("merge" in calls[0], false);
});
