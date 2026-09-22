"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeDiff } = require("./risk-engine");
const { classify, minimizeRepairContext } = require("./data-guard");
const { evaluateRepair } = require("./security-gate");

test("allows an ordinary bounded change", () => {
  const result = analyzeDiff({
    diff: [
      "diff --git a/core/example.js b/core/example.js",
      "--- a/core/example.js",
      "+++ b/core/example.js",
      "@@",
      "+const answer = 42;",
      " const x = answer;"
    ].join("\n")
  });
  assert.equal(result.decision, "ALLOW");
});

test("blocks dangerous execution patterns", () => {
  const result = analyzeDiff({
    diff: [
      "diff --git a/core/auth/login.js b/core/auth/login.js",
      "--- a/core/auth/login.js",
      "+++ b/core/auth/login.js",
      "@@",
      "+require('child_process').exec('rm -rf /tmp/cache');"
    ].join("\n")
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.findings.some(f => f.type === "process-execution"));
});

test("blocks verification bypasses", () => {
  const result = analyzeDiff({
    diff: [
      "diff --git a/core/auth.js b/core/auth.js",
      "--- a/core/auth.js",
      "+++ b/core/auth.js",
      "@@",
      "+function verifyToken(token) { return true; }"
    ].join("\n")
  });
  assert.equal(result.decision, "BLOCK");
});

test("redacts credentials before evidence is returned", () => {
  const result = analyzeDiff({
    diff: [
      "diff --git a/core/config.js b/core/config.js",
      "--- a/core/config.js",
      "+++ b/core/config.js",
      "@@",
      "+const api_key = \"sk-abcdefghijklmnopqrstuvwxyz123456\";"
    ].join("\n")
  });
  assert.equal(result.decision, "BLOCK");
  assert.match(result.evidence.redactedContext, /\[REDACTED\]/);
  assert.doesNotMatch(result.evidence.redactedContext, /abcdefghijklmnopqrstuvwxyz123456/);
});

test("classifies sensitive fields and minimizes repair context", () => {
  assert.equal(classify({ access_token: "x" }), "secret");
  const context = minimizeRepairContext({
    jobId: "job-1",
    repository: "owner/repo",
    commitSha: "abc",
    files: ["core/a.js"],
    evidenceRefs: ["ci:123"]
  });
  assert.deepEqual(context.files, ["core/a.js"]);
  assert.equal(context.policyVersion, "data-guard-v1");
});

test("security gate never enables autonomous write or merge", () => {
  const result = evaluateRepair({
    jobId: "job-1",
    repository: "owner/repo",
    commitSha: "abc",
    diff: "--- a/a.js\n+++ b/a.js\n@@\n+const ok = true;"
  });
  assert.equal(result.gate, "PASS");
  assert.equal(result.autonomousWrite, false);
  assert.equal(result.autonomousMerge, false);
});
