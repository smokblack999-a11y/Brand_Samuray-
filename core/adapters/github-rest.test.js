"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGithubRestClient } = require("./github-rest");

test("uses bearer auth and GitHub API version", async () => {
  let seen;
  const github = createGithubRestClient({
    token: "secret",
    owner: "o",
    repo: "r",
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, json: async () => ({ id: 7 }) };
    }
  });
  const result = await github.getWorkflowRun(7);
  assert.equal(result.id, 7);
  assert.equal(seen.options.headers.authorization, "Bearer secret");
  assert.equal(seen.options.headers["x-github-api-version"], "2026-03-10");
});

test("surfaces GitHub API failures", async () => {
  const github = createGithubRestClient({
    token: "secret", owner: "o", repo: "r",
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: "forbidden" }) })
  });
  await assert.rejects(() => github.getWorkflowRun(7), /github_api_403/);
});
