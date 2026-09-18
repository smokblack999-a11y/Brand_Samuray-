"use strict";

function createGitHubAdapter(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("GitHub token is required at runtime");
  const apiBase = String(options.apiBase || "https://api.github.com").replace(/\/$/, "");

  async function apiRequest(method, path, body) {
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
      throw new Error(message.replaceAll(token, "[REDACTED]"));
    }
    return data;
  }

  function repoPath(repo) {
    if (!/^[^/]+\/[^/]+$/.test(String(repo))) throw new Error("invalid GitHub repository");
    return String(repo);
  }

  function assertBranch(name) {
    const value = String(name);
    if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..") || value.startsWith("/") || value.endsWith("/"))
      throw new Error("invalid recovery branch");
  }

  return {
    async createBranch(input) {
      const repo = repoPath(input.repo);
      assertBranch(input.branch);
      if (!input.baseSha) throw new Error("baseSha required");
      return apiRequest("POST", `/repos/${repo}/git/refs`, {
        ref: `refs/heads/${input.branch}`,
        sha: input.baseSha
      });
    },

    async applyPatchAndCreateCommit(input) {
      const repo = repoPath(input.repo);
      assertBranch(input.branch);
      if (!input.baseSha) throw new Error("baseSha required");
      const files = Array.isArray(input.files) ? input.files : [];
      if (!files.length) throw new Error("patch files required");
      if (files.length > Number(input.maxFilesChanged || 10))
        throw new Error("patch exceeds maxFilesChanged");

      const baseCommit = await apiRequest("GET", `/repos/${repo}/git/commits/${input.baseSha}`);
      const baseTree = baseCommit?.tree?.sha;
      if (!baseTree) throw new Error("base tree not found");

      const entries = [];
      for (const file of files) {
        const filePath = String(file?.path || "");
        if (!filePath || filePath.startsWith("/") || filePath.includes("..") ||
            filePath.startsWith(".git/") || filePath.includes("\\0"))
          throw new Error("unsafe patch path");

        const blob = await apiRequest("POST", `/repos/${repo}/git/blobs`, {
          content: String(file.content ?? ""),
          encoding: "utf-8"
        });
        entries.push({path:filePath, mode:file.mode || "100644", type:"blob", sha:blob.sha});
      }

      const tree = await apiRequest("POST", `/repos/${repo}/git/trees`, {
        base_tree: baseTree, tree: entries
      });
      const commit = await apiRequest("POST", `/repos/${repo}/git/commits`, {
        message: input.message || "fix(recovery): apply verified recovery patch",
        tree: tree.sha, parents: [input.baseSha]
      });

      return {commitSha:commit.sha, treeSha:tree.sha, files:entries.map(x=>x.path)};
    },

    async updateBranch(input) {
      const repo = repoPath(input.repo);
      assertBranch(input.branch);
      if (!input.commitSha) throw new Error("commitSha required");
      return apiRequest("PATCH", `/repos/${repo}/git/refs/heads/${input.branch}`, {
        sha:input.commitSha, force:false
      });
    },

    async createPullRequest(input) {
      const repo = repoPath(input.repo);
      assertBranch(input.branch);
      return apiRequest("POST", `/repos/${repo}/pulls`, {
        title:input.title, body:input.body, head:input.branch,
        base:input.baseBranch || "main", draft:input.draft !== false
      });
    }
  };
}

function recoveryBranchName(jobId, attempt = 1) {
  const safe = String(jobId).replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 48);
  return `x10think/recovery-${safe}-a${Math.max(1, Number(attempt) || 1)}`;
}

module.exports = {createGitHubAdapter, recoveryBranchName};
