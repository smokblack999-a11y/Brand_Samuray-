"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeWorkflowRun, shouldEnqueue } = require("./nexus-intake");

test("normalizes a GitHub workflow_run failure", () => {
  const event = normalizeWorkflowRun({
    deliveryId: "delivery-1",
    repository: { full_name: "acme/app" },
    workflow_run: { id: 42, name: "CI", status: "completed", conclusion: "failure", head_sha: "abc", head_branch: "main", html_url: "https://example.test/run/42" }
  });
  assert.equal(event.repository, "acme/app");
  assert.equal(event.runId, 42);
  assert.equal(event.conclusion, "failure");
  assert.equal(shouldEnqueue(event), true);
});

test("successful workflow does not enter repair queue", () => {
  const event = normalizeWorkflowRun({
    repository: { full_name: "acme/app" },
    workflow_run: { id: 43, status: "completed", conclusion: "success" }
  });
  assert.equal(shouldEnqueue(event), false);
});
