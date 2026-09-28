"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nexus = require("./nexus-resource-policy");

test("15 real-life gates classify correctly", () => {
  const cases = [
    ["src/auth/login.js", "authentication"],
    ["services/crypto/key.js", "cryptography"],
    ["client/tls/client.js", "tls"],
    ["src/acl/rbac.js", "acl"],
    ["src/policy/access.js", "policy"],
    [".github/workflows/build.yml", "github_actions"],
    ["containers/Dockerfile", "docker"],
    ["src/app.test.js", "tests"],
    ["src/app_test.go", "tests_convention"],
    ["package.json", "dependencies"],
    ["infra/terraform/main.tf", "infrastructure"],
    ["config/app.yml", "configuration"],
    ["src/routes/users.js", "api_surface"],
    ["db/migrations/001.sql", "database"],
    ["src/index.js", "large_change"]
  ];
  assert.equal(cases.length, 15);
  for (const [file, category] of cases) {
    const input = category === "large_change"
      ? Array.from({ length: 20 }, (_, i) => "src/file" + i + ".js")
      : [file];
    assert.ok(nexus.classifyFiles(input).categories.includes(category), file);
  }
});

test("normal nested files remain normal", () => {
  const r = nexus.classifyFiles(["src/ui/button.js"]);
  assert.equal(r.criticality, "NORMAL");
  assert.deepEqual(r.categories, []);
});

test("invalid state transition is blocked", () => {
  const r = nexus.transition("REPAIR_PROPOSED", "CI_PASSED", {
    resource: "github://repo/pull/1",
    files: ["src/auth/login.js"]
  });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.state, "BLOCKED");
  assert.ok(r.reasons.includes("invalid_state_transition"));
});

test("dangerous added diff is fail-closed", () => {
  const r = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "github://repo/pull/2",
    files: ["src/index.js"],
    diff: ["--- a/src/index.js", "+++ b/src/index.js", "+ rm -rf /"].join("\n")
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasons.includes("dangerous_change_pattern"));
  assert.ok(r.dangerousFindings.includes("recursive_delete"));
});

test("dangerous text removed from old code does not block", () => {
  const r = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "github://repo/pull/3",
    files: ["src/index.js"],
    diff: ["--- a/src/index.js", "+++ b/src/index.js", "- rm -rf /", "+ safeOperation();"].join("\n")
  });
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.state, "REPAIR_PROPOSED");
});

test("critical transition requires proof and validation", () => {
  const r = nexus.transition("CI_PASSED", "READY_FOR_REVIEW", {
    resource: "github://repo/pull/4",
    files: [".github/workflows/build.yml"]
  });
  assert.equal(r.decision, "ALLOW");
  assert.deepEqual(r.requiredChecks, ["sandbox", "ci", "proof_receipt", "human_review"]);
});

test("workflow expression added to a workflow is blocked", () => {
  const expression = "$" + "{ github.event.pull_request.title }}";
  const r = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "github://repo/pull/5",
    files: [".github/workflows/build.yml"],
    diff: "+ run: echo \"" + expression + "\""
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.dangerousFindings.includes("workflow_command_injection"));
});

test("proof binds evaluation", () => {
  const e = nexus.transition("CI_PASSED", "READY_FOR_REVIEW", {
    resource: "github://repo/pull/6",
    files: ["src/crypto/key.js"]
  });
  const p = nexus.createProofReceipt({
    evaluation: e,
    beforeSha: "abc",
    afterSha: "def",
    validations: ["sandbox", "ci"]
  });
  assert.equal(p.schema, "nexus-proof-receipt/v2");
  assert.equal(p.proofHash.length, 64);
  assert.equal(p.evaluationHash, e.evaluationHash);
});

test("proof cannot be created from a blocked evaluation", () => {
  const e = nexus.transition("CI_FAILED", "CI_PASSED", {
    resource: "github://repo/pull/7",
    files: ["src/index.js"]
  });
  assert.throws(() => nexus.createProofReceipt({ evaluation: e }), /proof_requires_allowed_transition/);
});

test("missing identity blocks", () => {
  const r = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "",
    files: ["src/index.js"]
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasons.includes("resource_identity_missing"));
});
