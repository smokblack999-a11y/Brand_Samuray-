"use strict";

function createGithubPrAdapter({ create } = {}) {
  if (typeof create !== "function") throw new TypeError("create is required");
  return async function openPullRequest({ mission, execution }) {
    if (execution?.testResult?.passed !== true) throw new Error("pr_requires_sandbox_pass");
    return create({ mission, execution });
  };
}

module.exports = { createGithubPrAdapter };
