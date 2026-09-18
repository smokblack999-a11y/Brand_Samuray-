"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createX28Adapter } = require("./architect-x28-adapter");

test("X29 delegates planning to X28 instead of creating another state machine", async () => {
  const adapter = createX28Adapter({
    existingJobKeys: new Set(),
    policy: {
      maxAttempts: 2,
      maxChangedFiles: 8,
      maxChangedLines: 400,
      blockedPaths: [".env"]
    }
  });

  const planned = await adapter.plan({
    mission: {
      id: "x29-x28-1",
      type: "ci-repair",
      input: {
        workflowRun: {
          id: 123,
          status: "completed",
          conclusion: "failure",
          head_sha: "abc",
          name: "Core CI"
        }
      }
    }
  });

  assert.equal(planned.actions.length, 6);
  assert.equal(planned.x28.job.state, "queued");
});

test("X29 critic bridge maps X28 PASS to ALLOW", async () => {
  const adapter = createX28Adapter({
    existingJobKeys: new Set(),
    policy: {
      maxAttempts: 2,
      maxChangedFiles: 8,
      maxChangedLines: 400,
      blockedPaths: [".env"]
    }
  });

  const planned = await adapter.plan({
    mission: {
      id: "x29-x28-2",
      type: "ci-repair",
      input: {
        workflowRun: {
          id: 456,
          status: "completed",
          conclusion: "failure",
          head_sha: "def",
          name: "Core CI"
        }
      }
    }
  });

  const result = await adapter.criticEvaluate({
    x28: planned.x28,
    candidate: {
      rationale: "fix the failing test",
      changed_files: ["core/example.js"],
      changed_lines: 10,
      test_commands: ["npm test"]
    }
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.x28.job.state, "patching");
});
