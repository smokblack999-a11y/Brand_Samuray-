"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const hard988 = require("../hard988-repair-evidence-gate");

const SECRET = "test-only-secret-for-hard988-evidence-32-bytes-min";
const BEFORE = "a".repeat(40);
const AFTER = "b".repeat(40);
const T0 = "2026-10-14T10:00:00.000Z";
const T1 = "2026-10-14T10:01:00.000Z";
const T2 = "2026-10-14T10:02:00.000Z";
const T3 = "2026-10-14T10:03:00.000Z";

function signedCheck(name, overrides = {}) {
  const base = {
    checkId: name + "-run-001",
    name,
    status: "PASS",
    exitCode: 0,
    runnerId: "trusted-ci-runner-01",
    startedAt: name === "sandbox" ? T0 : T2,
    finishedAt: name === "sandbox" ? T1 : T3,
    artifactSha256: (name === "sandbox" ? "c" : "d").repeat(64),
    ...overrides
  };
  return hard988.signEvidence(base, SECRET);
}

function validInput(overrides = {}) {
  return {
    resource: "github://example/project/pull/17",
    fromState: "CI_PASSED",
    toState: "READY_FOR_REVIEW",
    files: ["src/fix.js"],
    diff: "+ return safeResult();",
    beforeSha: BEFORE,
    afterSha: AFTER,
    checks: [signedCheck("sandbox"), signedCheck("ci")],
    ...overrides
  };
}

test("valid signed sandbox and CI evidence reaches human review, never merge", () => {
  const result = hard988.evaluateHard988(validInput(), { secret: SECRET });
  assert.equal(result.decision, "READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.manualReviewRequired, true);
  assert.match(result.receiptHash, /^[a-f0-9]{64}$/);
});

test("missing trusted secret fails closed", () => {
  const result = hard988.evaluateHard988(validInput());
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("trusted_runner_secret_missing_or_too_short"));
});

test("unsigned or tampered evidence fails closed", () => {
  const input = validInput();
  input.checks[0] = { ...input.checks[0], status: "FAIL" };
  const result = hard988.evaluateHard988(input, { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("check_signature_invalid:sandbox"));
});

test("failed CI cannot be presented as a successful repair", () => {
  const input = validInput();
  input.checks[1] = signedCheck("ci", { status: "FAIL", exitCode: 1 });
  const result = hard988.evaluateHard988(input, { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("check_not_passed:ci"));
  assert.ok(result.reasons.includes("check_exit_code_not_zero:ci"));
});

test("missing sandbox evidence fails closed", () => {
  const result = hard988.evaluateHard988(validInput({ checks: [signedCheck("ci")] }), { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("required_check_missing:sandbox"));
});

test("CI must start after sandbox has finished", () => {
  const input = validInput();
  input.checks = [
    signedCheck("sandbox", { startedAt: T2, finishedAt: T3 }),
    signedCheck("ci", { startedAt: T0, finishedAt: T1 })
  ];
  const result = hard988.evaluateHard988(input, { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("ci_started_before_sandbox_finished"));
});

test("identical before and after commits fail closed", () => {
  const result = hard988.evaluateHard988(validInput({ afterSha: BEFORE }), { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("candidate_commit_not_distinct"));
});

test("dangerous diff is blocked by the existing NEXUS policy", () => {
  const result = hard988.evaluateHard988(validInput({ diff: "+ rm -rf /" }), { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("policy:dangerous_change_pattern"));
});

test("critical files remain review-gated", () => {
  const result = hard988.evaluateHard988(validInput({ files: [".github/workflows/build.yml"] }), { secret: SECRET });
  assert.equal(result.decision, "READY_FOR_HUMAN_REVIEW");
  assert.equal(result.mergeAllowed, false);
  assert.ok(result.requiredChecks.includes("human_review"));
});

test("evidence signature cannot be reused after artifact digest mutation", () => {
  const input = validInput();
  input.checks[0] = { ...input.checks[0], artifactSha256: "f".repeat(64) };
  const result = hard988.evaluateHard988(input, { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("check_signature_invalid:sandbox"));
});

test("malformed commit identities fail closed", () => {
  const result = hard988.evaluateHard988(validInput({ beforeSha: "abc", afterSha: "def" }), { secret: SECRET });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasons.includes("before_after_commit_sha_invalid"));
});
