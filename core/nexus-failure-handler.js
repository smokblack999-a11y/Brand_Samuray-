"use strict";

const { createGitHubClient } = require("./nexus-github");

function createFailureHandler({ githubClient } = {}) {
  const github = githubClient || createGitHubClient({
    token: process.env.NEXUS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  });

  return async function handleFailure(job) {
    if (!job?.repository || !job?.runId) throw new Error("Invalid NEXUS GitHub failure job");

    const diagnosis = await github.collectFailure(job);
    const nextAction = diagnosis.category === "generic" || diagnosis.confidence < 0.8
      ? "HUMAN_REVIEW"
      : "PATCH_CANDIDATE";

    return {
      status: nextAction === "HUMAN_REVIEW" ? "HUMAN_REVIEW" : "DIAGNOSED",
      stage: "DIAGNOSED",
      nextAction,
      diagnosis
    };
  };
}

module.exports = { createFailureHandler };
