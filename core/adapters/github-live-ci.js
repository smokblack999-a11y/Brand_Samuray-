"use strict";

const { createGithubCiVerifier } = require("./github-ci-verifier");

function createLiveGithubCiVerifier({ github }) {
  if (!github) throw new TypeError("github is required");
  return createGithubCiVerifier({
    getStatus: async ({ mission }) => {
      const run = mission?.input?.workflowRun || mission?.input?.workflow_run || {};
      if (!run.id) return { conclusion: null, reason: "workflow_run_id_missing" };
      return github.getWorkflowRun(run.id);
    }
  });
}

module.exports = { createLiveGithubCiVerifier };
