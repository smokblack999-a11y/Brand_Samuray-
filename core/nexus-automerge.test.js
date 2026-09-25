"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { autonomousMerge, assertPreflight } = require("../nexus-automerge");

function mockFetch(responses) {
  const calls = [];
  return Object.assign(async (url, options = {}) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      async text() { return JSON.stringify(next.body || {}); }
    };
  }, { calls });
}

const pr = {
  state: "open",
  draft: false,
  merged: false,
  mergeable: true,
  mergeable_state: "clean",
  base: { ref: "main" },
  head: { ref: "recovery/abc", sha: "head-sha" }
};

const proof = {
  proofId: "NXS-PROOF-abc",
  headSha: "head-sha",
  gates: { sandbox: true, regression: true, githubCi: true }
};

test("Kill Critic merge gate rejects SHA drift", () => {
  const result = assertPreflight({
    pr: { ...pr, head: { ...pr.head, sha: "new-sha" } },
    checkRuns: [{ conclusion: "success" }],
    statuses: [{ state: "success" }],
    proof,
    baseBranch: "main"
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.includes("PROOF_HEAD_SHA_MISMATCH"), true);
});

test("merge gate fails closed on failed or missing CI evidence", () => {
  const failed = assertPreflight({
    pr,
    checkRuns: [{ conclusion: "failure" }],
    statuses: [{ state: "success" }],
    proof,
    baseBranch: "main"
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.failures.includes("FAILED_CHECK_RUNS"), true);

  const missing = assertPreflight({
    pr,
    checkRuns: [],
    statuses: [],
    proof,
    baseBranch: "main"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.failures.includes("NO_CHECK_RUNS"), true);
});

test("autonomous merge uses exact head SHA and squash", async () => {
  const fetchImpl = mockFetch([
    { body: pr },
    { body: { check_runs: [{ conclusion: "success" }] } },
    { body: { statuses: [{ state: "success" }] } },
    { body: { merged: true, sha: "merge-sha" } }
  ]);

  const result = await autonomousMerge({
    repository: "acme/app",
    prNumber: 42,
    expectedHeadSha: "head-sha",
    proof,
    token: "test-token",
    fetchImpl
  });

  assert.equal(result.merged, true);
  assert.equal(result.sha, "merge-sha");
  const mergeCall = fetchImpl.calls[3];
  assert.equal(mergeCall.options.method, "PUT");
  const body = JSON.parse(mergeCall.options.body);
  assert.equal(body.sha, "head-sha");
  assert.equal(body.merge_method, "squash");
});

test("autonomous merge does not write when preflight is blocked", async () => {
  const fetchImpl = mockFetch([
    { body: { ...pr, mergeable_state: "blocked" } },
    { body: { check_runs: [{ conclusion: "success" }] } },
    { body: { statuses: [{ state: "success" }] } }
  ]);

  const result = await autonomousMerge({
    repository: "acme/app",
    prNumber: 42,
    expectedHeadSha: "head-sha",
    proof,
    token: "test-token",
    fetchImpl
  });

  assert.equal(result.merged, false);
  assert.equal(result.blocked, true);
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(fetchImpl.calls.some(call => call.options.method === "PUT"), false);
});

test("already merged PR is idempotent", async () => {
  const fetchImpl = mockFetch([{ body: { ...pr, merged: true, merge_commit_sha: "existing-merge" } }]);
  const result = await autonomousMerge({
    repository: "acme/app",
    prNumber: 42,
    expectedHeadSha: "head-sha",
    proof,
    token: "test-token",
    fetchImpl
  });
  assert.equal(result.merged, true);
  assert.equal(result.idempotent, true);
  assert.equal(result.sha, "existing-merge");
});
