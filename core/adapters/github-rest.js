"use strict";

function createGithubRestClient({ token, owner, repo, apiBase = "https://api.github.com", fetchImpl = globalThis.fetch } = {}) {
  if (!token || !owner || !repo || typeof fetchImpl !== "function") throw new TypeError("token, owner, repo and fetchImpl are required");

  async function request(path, options = {}) {
    const response = await fetchImpl(apiBase + path, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + token,
        "x-github-api-version": "2026-03-10",
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("github_api_" + response.status);
      error.status = response.status; error.body = body; throw error;
    }
    return body;
  }

  return {
    getWorkflowRun: id => request(`/repos/${owner}/${repo}/actions/runs/${id}`),
    getFile: async ({ path, ref }) => {
      const current = await request(`/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
      if (current?.type !== "file" || !current?.content) throw new Error("github_file_not_available");
      return { path, sha: current.sha, content: Buffer.from(current.content.replace(/\s/g, ""), "base64").toString("utf8") };
    },
    listWorkflowRuns: ({ branch, headSha, event, perPage = 10 } = {}) => {
      const params = new URLSearchParams();
      if (branch) params.set("branch", branch);
      if (headSha) params.set("head_sha", headSha);
      if (event) params.set("event", event);
      params.set("per_page", String(perPage));
      return request(`/repos/${owner}/${repo}/actions/runs?${params}`);
    },
    getPullRequest: number => request(`/repos/${owner}/${repo}/pulls/${number}`),
    compareBranches: ({ base, head }) => request(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`),
    createPullRequest: input => request(`/repos/${owner}/${repo}/pulls`, { method: "POST", body: JSON.stringify(input) }),
    createBranch: async ({ branch, from }) => {
      const ref = await request(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(from)}`);
      return request(`/repos/${owner}/${repo}/git/refs`, {
        method: "POST", body: JSON.stringify({ ref: "refs/heads/" + branch, sha: ref.object.sha })
      });
    },
    upsertFile: async ({ branch, path, content, message }) => {
      let sha;
      try {
        const current = await request(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
        sha = current.sha;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      const body = { message, content: Buffer.from(content, "utf8").toString("base64"), branch };
      if (sha) body.sha = sha;
      return request(`/repos/${owner}/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify(body) });
    }
  };
}

module.exports = { createGithubRestClient };
