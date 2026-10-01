"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nexus = require("../nexus-resource-policy");

test("15 real-life gates classify changed files", () => {
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
    ["db/migrations/001.sql", "database"]
  ];

  for (const [file, category] of cases) {
    assert.ok(nexus.classifyFiles([file]).categories.includes(category), file);
  }

  assert.equal(
    nexus.classifyFiles(Array.from({ length: 20 }, (_, i) => "src/file" + i + ".js")).categories.includes("large_change"),
    true
  );
});

test("ordinary UI change stays NORMAL", () => {
  const result = nexus.classifyFiles(["src/ui/button.js"]);
  assert.equal(result.criticality, "NORMAL");
  assert.deepEqual(result.categories, []);
});

test("invalid state transition fails closed", () => {
  const result = nexus.transition("REPAIR_PROPOSED", "CI_PASSED", {
    resource: "github://repo/pull/1",
    files: ["src/index.js"]
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.state, "BLOCKED");
  assert.ok(result.reasons.includes("invalid_state_transition"));
});

test("dangerous added diff is blocked", () => {
  const result = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "github://repo/pull/2",
    files: ["src/index.js"],
    diff: [
      "--- a/src/index.js",
      "+++ b/src/index.js",
      "+ rm -rf /"
    ].join("\n")
  });

  assert.equal(result.decision, "BLOCK");
  assert.ok(result.dangerousFindings.includes("recursive_delete"));
});

test("removed dangerous code alone does not block", () => {
  const result = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "github://repo/pull/3",
    files: ["src/index.js"],
    diff: [
      "--- a/src/index.js",
      "+++ b/src/index.js",
      "- rm -rf /",
      "+ safeOperation();"
    ].join("\n")
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.state, "REPAIR_PROPOSED");
});

test("critical path requires explicit downstream checks", () => {
  const result = nexus.transition("CI_PASSED", "READY_FOR_REVIEW", {
    resource: "github://repo/pull/4",
    files: [".github/workflows/build.yml"]
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(
    result.requiredChecks,
    ["sandbox", "ci", "proof_receipt", "human_review"]
  );
});

test("workflow event expression is detected in added command", () => {
  const expression = "$" + "{ github.event.pull_request.title }}";
  const result = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "github://repo/pull/5",
    files: [".github/workflows/build.yml"],
    diff: "+ run: echo \"" + expression + "\""
  });

  assert.equal(result.decision, "BLOCK");
  assert.ok(result.dangerousFindings.includes("workflow_command_injection"));
});

test("proof receipt binds evaluation hash and commit transition", () => {
  const evaluation = nexus.transition("CI_PASSED", "READY_FOR_REVIEW", {
    resource: "github://repo/pull/6",
    files: ["src/crypto/key.js"]
  });

  const proof = nexus.createProofReceipt({
    evaluation,
    beforeSha: "abc",
    afterSha: "def",
    validations: ["sandbox", "ci"]
  });

  assert.equal(proof.schema, "nexus-proof-receipt/v2");
  assert.equal(proof.evaluationHash, evaluation.evaluationHash);
  assert.match(proof.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(proof.transition.from, "CI_PASSED");
  assert.equal(proof.transition.to, "READY_FOR_REVIEW");
});

test("blocked evaluation cannot emit proof", () => {
  const evaluation = nexus.transition("CI_FAILED", "CI_PASSED", {
    resource: "github://repo/pull/7",
    files: ["src/index.js"]
  });

  assert.throws(
    () => nexus.createProofReceipt({ evaluation }),
    /proof_requires_allowed_transition/
  );
});

test("missing resource identity is blocked", () => {
  const result = nexus.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource: "",
    files: ["src/index.js"]
  });

  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("resource_identity_missing"));
});
