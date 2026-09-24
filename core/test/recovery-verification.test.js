"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getVerification } = require("../recovery-verification");

test("verification rejects missing identity", async () => {
  const r = await getVerification({});
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "VERIFICATION_IDENTITY_REQUIRED");
});

test("verification rejects unverified CI override", async () => {
  const old = process.env.X10THINK_ALLOW_UNVERIFIED_CI;
  process.env.X10THINK_ALLOW_UNVERIFIED_CI = "true";
  try {
    const r = await getVerification({
      repository: "smokblack999-a11y/Brand_Samuray-",
      headSha: "abc",
      workflowRunId: 123
    });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, "UNVERIFIED_CI_OVERRIDE_FORBIDDEN");
  } finally {
    if (old === undefined) delete process.env.X10THINK_ALLOW_UNVERIFIED_CI;
    else process.env.X10THINK_ALLOW_UNVERIFIED_CI = old;
  }
});
