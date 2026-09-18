"use strict";

const crypto = require("crypto");

const API = "https://api.github.com";
const VERSION = "2022-11-28";

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
  const installationId = required("GITHUB_INSTALLATION_ID");
  const result = await json(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appJwt()}` }
  });
  return result.token;
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
  const data = await githubJson(`/repos/${repoPath(repository)}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
  });
  return data;
}

async function applyFiles({ repository, branchName, patches, message }) {
  const repo = repoPath(repository);
  let lastCommit = null;
  for (const patch of patches) {
    const existing = await githubJson(`/repos/${repo}/contents/${patch.path}?ref=${encodeURIComponent(branchName)}`);
    lastCommit = await githubJson(`/repos/${repo}/contents/${patch.path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(patch.content, "utf8").toString("base64"),
        sha: existing.sha,
        branch: branchName
      })
    });
  }
  return lastCommit;
}

async function createPullRequest({ repository, head, base, title, body, draft }) {
  return githubJson(`/repos/${repoPath(repository)}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base, draft: Boolean(draft) })
  });
}

module.exports = { appJwt, installationToken, createBranch, applyFiles, createPullRequest };
