"use strict";

function createGithubRestClient({ token, owner, repo, apiBase = "https://api.github.com", fetchImpl = globalThis.fetch } = {}) {
  if (!token || !owner || !repo || typeof fetchImpl !== "function") throw new TypeError("token, owner, repo and fetchImpl are required");

  async function request(path, options = {}) {
    const response = await fetchImpl(apiBase + path, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + token,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("github_api_" + response.status);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  return {
    getWorkflowRun: id => request(`/repos/${owner}/${repo}/actions/runs/${id}`),
    getPullRequest: number => request(`/repos/${owner}/${repo}/pulls/${number}`),
    createPullRequest: input => request(`/repos/${owner}/${repo}/pulls`, {
      method: "POST", body: JSON.stringify(input)
    })
  };
}

module.exports = { createGithubRestClient };
