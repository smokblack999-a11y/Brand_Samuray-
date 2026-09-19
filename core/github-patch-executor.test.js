"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePath, validatePatches, validateDiagnosis, validateAffectedFiles, executePatch } = require("./github-patch-executor");

test("rejects traversal and protected files", () => {
  assert.throws(() => normalizePath("../secret.js"), /traversal/i);
  assert.throws(() => normalizePath(".env"), /Protected path/i);
  assert.throws(() => normalizePath(".github/workflows/core.yml"), /Protected path/i);
});

test("accepts bounded UTF-8 replacement patches", () => {
  const patches = validatePatches([{ path: "core/example.js", content: "module.exports = 1;\n" }]);
  assert.equal(patches[0].path, "core/example.js");
});

test("patches must stay inside diagnosed affected_files", () => {
  const diagnosis = { affected_files: ["core/example.js"] };
  assert.doesNotThrow(() => validateAffectedFiles(diagnosis, [{ path: "core/example.js", content: "x\n" }]));
  assert.throws(
    () => validateAffectedFiles(diagnosis, [{ path: "core/other.js", content: "x\n" }]),
    /outside diagnosed affected_files/i
  );
  assert.throws(
    () => validateAffectedFiles({}, [{ path: "core/example.js", content: "x\n" }]),
    /affected_files is required/i
  );
});

test("requires evidence-backed patch readiness", () => {
  assert.throws(() => validateDiagnosis({ patch_ready: false, confidence: 0.99, blockers: [] }), /not patch-ready/i);
  assert.throws(() => validateDiagnosis({ patch_ready: true, confidence: 0.69, blockers: [] }), /below 0.7/i);
  assert.doesNotThrow(() => validateDiagnosis({ patch_ready: true, confidence: 0.91, blockers: [] }));
});

test("sandbox failure prevents every GitHub mutation", async () => {
  const calls = [];
  await assert.rejects(() => executePatch({
    job: { id: "job-1", repository: "owner/repo", headSha: "abcdef1234567890", runId: 42 },
    diagnosis: { patch_ready: true, confidence: 0.91, blockers: [], affected_files: ["core/example.js"], tests_to_run: ["npm test"] },
    patches: [{ path: "core/example.js", content: "x\n" }],
    sandbox: { applyAndTest: async () => ({ passed: false }) },
    gitHub: {
      createBranch: async () => calls.push("branch"),
      applyFiles: async () => calls.push("files"),
      createPullRequest: async () => calls.push("pr")
    }
  }), /Sandbox verification failed/i);
  assert.deepEqual(calls, []);
});

test("successful sandbox creates isolated branch then draft PR", async () => {
  const calls = [];
  const result = await executePatch({
    job: { id: "job-2", repository: "owner/repo", headSha: "abcdef1234567890", runId: 43 },
    diagnosis: { patch_ready: true, confidence: 0.95, blockers: [], affected_files: ["core/example.js"], tests_to_run: ["npm test"] },
    patches: [{ path: "core/example.js", content: "x\n" }],
    sandbox: { applyAndTest: async input => ({ passed: true, tests: input.tests }) },
    gitHub: {
      createBranch: async input => calls.push(["branch", input.branchName]),
      applyFiles: async input => calls.push(["files", input.branchName]),
      createPullRequest: async input => {
        calls.push(["pr", input.head, input.draft]);
        return { number: 10 };
      }
    }
  });
  assert.equal(result.branchName, "repair/job-2-abcdef12");
  assert.deepEqual(calls, [
    ["branch", "repair/job-2-abcdef12"],
    ["files", "repair/job-2-abcdef12"],
    ["pr", "repair/job-2-abcdef12", true]
  ]);
});
