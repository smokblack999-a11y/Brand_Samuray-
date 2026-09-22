"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { diagnose, fingerprint } = require("./nexus-diagnosis");

test("diagnoses failed test step deterministically", () => {
  const result = diagnose({
    run: { id: 42, name: "CI", head_sha: "abc123", conclusion: "failure", html_url: "https://github.com/example/repo/actions/runs/42" },
    jobs: [{ id: 7, name: "unit-tests", conclusion: "failure", steps: [{ name: "npm test", conclusion: "failure" }] }]
  });
  assert.equal(result.category, "test_failure");
  assert.equal(result.confidence, 0.98);
  assert.equal(result.failedSteps[0].stepName, "npm test");
  assert.equal(result.evidence.runId, 42);
  assert.equal(result.fingerprint, fingerprint("unit-tests: npm test\nCI"));
});

test("prioritizes explicit OOM evidence", () => {
  const result = diagnose({
    run: { id: 99, name: "Android", conclusion: "failure" },
    jobs: [{ id: 8, name: "build", conclusion: "failure", steps: [{ name: "Gradle", conclusion: "failure" }] }],
    logs: "Java heap space: OutOfMemoryError"
  });
  assert.equal(result.category, "out_of_memory");
  assert.equal(result.confidence, 0.99);
});

test("falls back safely when failure evidence is sparse", () => {
  const result = diagnose({ run: { id: 1, name: "CI", conclusion: "failure" }, jobs: [] });
  assert.equal(result.category, "generic");
  assert.equal(result.confidence, 0.55);
  assert.equal(result.failedSteps.length, 0);
});
