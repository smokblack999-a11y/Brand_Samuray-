"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGithubCiVerifier } = require("./github-ci-verifier");

test("requires successful CI conclusion", async () => {
  const verifier = createGithubCiVerifier({ getStatus: async () => ({ conclusion: "failure" }) });
  assert.equal((await verifier({ mission: {}, execution: {} })).passed, false);
  const ok = createGithubCiVerifier({ getStatus: async () => ({ conclusion: "success" }) });
  assert.equal((await ok({ mission: {}, execution: {} })).passed, true);
});
