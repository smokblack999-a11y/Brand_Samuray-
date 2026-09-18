"use strict";

const crypto = require("crypto");

const API = "https://api.github.com";
const VERSION = "2022-11-28";
const TOKEN_SKEW_MS = 60_000;
let cachedInstallationToken = null;
let cachedInstallationTokenExpiresAt = 0;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function appJwt() {
  const appId = required("GITHUB_APP_ID");
  const key = required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(input).sign(key).toString("base64url");
  return `${input}.${signature}`;
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": VERSION,
      "User-Agent": "SamuraiOS-X18-Agent",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : {};
}

async function installationToken() {
  const now = Date.now();
  if (cachedInstallationToken && now < cachedInstallationTokenExpiresAt - TOKEN_SKEW_MS) {
    return cachedInstallationToken;
  }

  const installationId = required("GITHUB_INSTALLATION_ID");
  const result = await json(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appJwt()}` }
  });
  const token = String(result?.token || "").trim();
  if (!token) throw new Error("GitHub App installation token was not returned");

  cachedInstallationToken = token;
  const expiresAt = Date.parse(String(result?.expires_at || ""));
  cachedInstallationTokenExpiresAt = Number.isFinite(expiresAt)
    ? expiresAt
    : now + 50 * 60_000;
  return token;
}

async function githubJson(pathname, options = {}) {
  const token = await installationToken();
  return json(`${API}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
}

function repoPath(repository) {
  const parts = String(repository || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid repository");
  return parts.map(encodeURIComponent).join("/");
}

async function createBranch({ repository, branchName, baseSha }) {
  const refPath = `/repos/${repoPath(repository)}/git/ref/heads/${encodeURIComponent(branchName)}`;
  try {
    const existing = await githubJson(refPath);
    const existingSha = String(existing?.object?.sha || "");
    if (existingSha !== String(baseSha)) {
      throw new Error(`GitHub branch already exists at a different SHA: ${branchName}`);
    }
    return existing;
  } catch (error) {
    if (!/GitHub API 404:/.test(String(error?.message || ""))) throw error;
  }

  return githubJson(`/repos/${repoPath(repository)}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
  });
}

async function applyFiles({ repository, branchName, patches, message }) {
  if (!Array.isArray(patches) || patches.length < 1) {
    throw new Error("At least one patch is required");
  }

  const repo = repoPath(repository);
  const ref = await githubJson(
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`
  );
  const parentSha = String(ref?.object?.sha || "");
  if (!parentSha) throw new Error("GitHub branch SHA was not returned");

  const blobs = [];
  for (const patch of patches) {
    const blob = await githubJson(`/repos/${repo}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: Buffer.from(patch.content, "utf8").toString("base64"),
        encoding: "base64"
      })
    });
    const blobSha = String(blob?.sha || "");
    if (!blobSha) throw new Error(`GitHub blob SHA was not returned: ${patch.path}`);
    blobs.push({
      path: patch.path,
      mode: "100644",
      type: "blob",
      sha: blobSha
    });
  }

  const parentCommit = await githubJson(`/repos/${repo}/git/commits/${parentSha}`);
  const baseTreeSha = String(parentCommit?.tree?.sha || "");
  if (!baseTreeSha) throw new Error("GitHub parent tree SHA was not returned");

  const tree = await githubJson(`/repos/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobs
    })
  });
  const treeSha = String(tree?.sha || "");
  if (!treeSha) throw new Error("GitHub tree SHA was not returned");

  const commit = await githubJson(`/repos/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [parentSha]
    })
  });
  const commitSha = String(commit?.sha || "");
  if (!commitSha) throw new Error("GitHub commit SHA was not returned");

  const updated = await githubJson(
    `/repos/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commitSha, force: false })
    }
  );

  return { ...updated, commitSha, parentSha, treeSha, atomic: true };
}
async function createPullRequest({ repository, head, base, title, body, draft }) {
  return githubJson(`/repos/${repoPath(repository)}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base, draft: Boolean(draft) })
  });
}

module.exports = { appJwt, installationToken, githubJson, createBranch, applyFiles, createPullRequest };
