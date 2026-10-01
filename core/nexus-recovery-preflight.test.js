"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePreflight } = require("./nexus-recovery-preflight");

test("failed workflow with safe diff reaches repair proposal", () => {
  const result = evaluatePreflight({
    conclusion: "failure",
    resource: "github://repo/workflow/123",
    headSha: "abc",
    baseSha: "def",
    files: ["src/app.js"],
    diff: "+safeOperation();"
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.state, "REPAIR_PROPOSED");
});

test("dangerous diff blocks before recovery transport", () => {
  const result = evaluatePreflight({
    conclusion: "failure",
    resource: "github://repo/workflow/124",
    headSha: "abc",
    baseSha: "def",
    files: ["src/app.js"],
    diff: "+ rm -rf /"
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.state, "BLOCKED");
});

test("successful workflow is never routed as recovery", () => {
  const result = evaluatePreflight({
    conclusion: "success",
    resource: "github://repo/workflow/125",
    headSha: "abc"
  });
  assert.equal(result.decision, "SKIP");
});
