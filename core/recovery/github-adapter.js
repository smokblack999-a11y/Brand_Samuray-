"use strict";

/**
 * Runtime-only GitHub adapter.
 * The token is injected at process startup and is never part of a recovery job,
 * patch, event, proof, or PR payload.
 */
function createGitHubAdapter(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("GitHub token is required at runtime");
  const apiBase = String(options.apiBase || "https://api.github.com").replace(/\\/$/, "");

  async function request(method, path, body) {
    const response = await fetch(apiBase + path, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : {"Content-Type": "application/json"})
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const message = data?.message ? String(data.message) : `GitHub API ${response.status}`;
      throw new Error(message.replace(token, "[REDACTED]"));
    }
    return data;
  }

  function repoPath(repo) {
    if (!/^[^/]+\\/[^/]+$/.test(String(repo))) throw new Error("invalid GitHub repository");
    return String(repo);
  }

  function assertBranch(name) {
    if (!/^[A-Za-z0-9._/-]+$/.test(String(name)) || String(name).includes(".."))
      throw new Error("invalid recovery branch");
  }

  return {
    async createBranch(request) {
      const repo = repoPath(request.repo);
      assertBranch(request.branch);
      if (!request.baseSha) throw new Error("baseSha required");
      return request("POST", `/repos/${repo}/git/refs`, {
        ref: `refs/heads/${request.branch}`,
        sha: request.baseSha
      });
    },

    async createPullRequest(request) {
      const repo = repoPath(request.repo);
      assertBranch(request.branch);
      return request("POST", `/repos/${repo}/pulls`, {
        title: request.title,
        body: request.body,
        head: request.branch,
        base: request.baseBranch || "main",
        draft: request.draft !== false
      });
    },

    async applyPatchAndCreateCommit(request) {
      const repo = repoPath(request.repo);
      assertBranch(request.branch);
      if (!request.baseSha) throw new Error("baseSha required");
      const files = Array.isArray(request.files) ? request.files : [];
      if (!files.length) throw new Error("patch files required");
      if (files.length > Number(request.maxFilesChanged || 10))
        throw new Error("patch exceeds maxFilesChanged");

      const baseCommit = await request("GET", `/repos/${repo}/git/commits/${request.baseSha}`);
      const baseTree = baseCommit?.tree?.sha;
      if (!baseTree) throw new Error("base tree not found");

      const entries = [];
      for (const file of files) {
        if (!file?.path || file.path.startsWith("/") || file.path.includes("..") || file.path.startsWith(".git/"))
          throw new Error("unsafe patch path");
        const blob = await request("POST", `/repos/${repo}/git/blobs`, {
          content: String(file.content ?? ""),
          encoding: "utf-8"
        });
        entries.push({
          path: file.path,
          mode: file.mode || "100644",
          type: "blob",
          sha: blob.sha
        });
      }

      const tree = await request("POST", `/repos/${repo}/git/trees`, {
        base_tree: baseTree,
        tree: entries
      });
      const commit = await request("POST", `/repos/${repo}/git/commits`, {
        message: request.message || "fix(recovery): apply verified recovery patch",
        tree: tree.sha,
        parents: [request.baseSha]
      });

      return { commitSha: commit.sha, treeSha: tree.sha, files: entries.map(x => x.path) };
    },

    async updateBranch(request) {
      const repo = repoPath(request.repo);
      assertBranch(request.branch);
      if (!request.commitSha) throw new Error("commitSha required");
      return request("PATCH", `/repos/${repo}/git/refs/heads/${request.branch}`, {
        sha: request.commitSha,
        force: false
      });
    }
  };
}

function recoveryBranchName(jobId, attempt = 1) {
  const safe = String(jobId).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48);
  return `x10think/recovery-${safe}-a${Number(attempt) || 1}`;
}

module.exports = { createGitHubAdapter, recoveryBranchName };
