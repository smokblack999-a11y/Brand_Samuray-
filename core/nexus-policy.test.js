"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyRisk, enforcePolicy } = require("./nexus-policy");

const evidence = [{ command: "npm test", exitCode: 0, logHash: "a", commitSha: "b" }];
const critic = { correctness: "PASS", regression: "PASS", security: "PASS", scope: "PASS" };

test("workflow and auth changes are critical", () => {
  assert.equal(classifyRisk({ changedFiles: [".github/workflows/ci.yml"] }), "CRITICAL");
  assert.equal(classifyRisk({ changedFiles: ["src/auth/token.js"] }), "CRITICAL");
});

test("ordinary small patch stays low risk", () => {
  assert.equal(classifyRisk({ changedFiles: ["README.md"] }), "LOW");
});

test("policy requires human review for critical changes", () => {
  const result = enforcePolicy({ changedFiles: [".github/workflows/ci.yml"], evidence, critic, security: "PASS", policy: "PASS" });
  assert.equal(result.risk, "CRITICAL");
  assert.equal(result.humanRequired, true);
  assert.equal(result.decision, "HUMAN_REVIEW");
});
