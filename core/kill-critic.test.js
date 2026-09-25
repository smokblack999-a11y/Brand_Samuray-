"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePatch, isCriticalPath } = require("./kill-critic");

test("blocks destructive commands in added lines", () => {
  const diff = [
    "diff --git a/core/a.js b/core/a.js",
    "--- a/core/a.js",
    "+++ b/core/a.js",
    "@@",
    "+rm -rf /tmp/cache"
  ].join("\\n");
  const result = evaluatePatch({ diff, testsPassed:true, buildPassed:true });
  assert.equal(result.decision, "block");
  assert.equal(result.reason, "deterministic-policy-violation");
});

test("critical security paths require review even when clean", () => {
  const diff = [
    "diff --git a/core/auth/login.js b/core/auth/login.js",
    "--- a/core/auth/login.js",
    "+++ b/core/auth/login.js",
    "@@",
    "+const enabled = true;"
  ].join("\\n");
  const result = evaluatePatch({ diff, testsPassed:true, buildPassed:true });
  assert.equal(result.decision, "review");
  assert.ok(result.evidence.criticalFiles.includes("core/auth/login.js"));
});

test("clean ordinary patch can pass only with build and tests", () => {
  const diff = [
    "diff --git a/core/readme.js b/core/readme.js",
    "--- a/core/readme.js",
    "+++ b/core/readme.js",
    "@@",
    "+module.exports = { ok: true };"
  ].join("\\n");
  assert.equal(evaluatePatch({ diff, testsPassed:false, buildPassed:true }).decision, "review");
  assert.equal(evaluatePatch({ diff, testsPassed:true, buildPassed:true }).decision, "pass");
});

test("critical path detection covers workflow and Dockerfile", () => {
  assert.equal(isCriticalPath(".github/workflows/ci.yml"), true);
  assert.equal(isCriticalPath("Dockerfile"), true);
  assert.equal(isCriticalPath("core/crypto/key.js"), true);
  assert.equal(isCriticalPath("core/ui/view.js"), false);
});
