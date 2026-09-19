"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { verifySignature, createWorkflowRunIngress } = require("./github-workflow-run");

function sign(body, secret) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("workflow_run ingress rejects invalid signatures", () => {
  const queue = { enqueue() { throw new Error("must not enqueue"); } };
  const ingress = createWorkflowRunIngress({ queue, secret: "secret" });
  const body = Buffer.from(JSON.stringify({ workflow_run: {} }));
  const result = ingress.accept({ rawBody: body, signature: "sha256=bad", eventName: "workflow_run", payload: JSON.parse(body) });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid_signature");
});

test("workflow_run ingress verifies, routes and deduplicates at the queue boundary", () => {
  const calls = [];
  const queue = { enqueue(job) { calls.push(job); return { claimed: true, job }; } };
  const ingress = createWorkflowRunIngress({ queue, secret: "secret" });
  const payload = {
    workflow_run: {
      id: 99,
      conclusion: "failure",
      head_sha: "abc123",
      head_branch: "feat/test",
      name: "Core CI",
      repository: { full_name: "owner/repo" }
    }
  };
  const body = Buffer.from(JSON.stringify(payload));
  const result = ingress.accept({
    rawBody: body,
    signature: sign(body, "secret"),
    eventName: "workflow_run",
    payload
  });
  assert.equal(result.accepted, true);
  assert.equal(result.queued.claimed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jobKey, "github:owner/repo:99:failure");
  assert.equal(verifySignature(body, sign(body, "secret"), "secret"), true);
});
