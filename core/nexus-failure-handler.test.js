"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createFailureHandler } = require("./nexus-failure-handler");

test("failure handler returns diagnosis and patch candidate", async () => {
  const handler = createFailureHandler({
    githubClient: {
      collectFailure: async () => ({ category: "test_failure", confidence: 0.98, fingerprint: "abc", failedSteps: [], evidence: {} })
    }
  });
  const result = await handler({ repository: "owner/repo", runId: "10" });
  assert.equal(result.stage, "DIAGNOSED");
  assert.equal(result.nextAction, "PATCH_CANDIDATE");
  assert.equal(result.diagnosis.category, "test_failure");
});

test("low-confidence diagnosis is sent to human review", async () => {
  const handler = createFailureHandler({
    githubClient: {
      collectFailure: async () => ({ category: "generic", confidence: 0.55, fingerprint: "abc", failedSteps: [], evidence: {} })
    }
  });
  const result = await handler({ repository: "owner/repo", runId: "11" });
  assert.equal(result.nextAction, "HUMAN_REVIEW");
});
