"use strict";

const { createGithubCiVerifier } = require("./github-ci-verifier");

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createLiveGithubCiVerifier({ github, pollMs = 5000, timeoutMs = 120000 } = {}) {
  if (!github) throw new TypeError("github is required");
  return createGithubCiVerifier({
    getStatus: async ({ execution }) => {
      const sha = execution?.pr?.head?.sha || execution?.pr?.head_sha || execution?.commit?.sha;
      if (!sha) return { conclusion: null, reason: "pr_head_sha_missing" };

      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const result = await github.listWorkflowRuns({ headSha: sha, event: "pull_request", perPage: 20 });
        const runs = Array.isArray(result?.workflow_runs) ? result.workflow_runs : [];
        const completed = runs.find(run => run.status === "completed");
        if (completed) return completed;
        await sleep(pollMs);
      }
      return { conclusion: null, reason: "ci_timeout", head_sha: sha };
    }
  });
}

module.exports = { createLiveGithubCiVerifier };
