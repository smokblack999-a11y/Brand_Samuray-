"use strict";

const API = "https://api.github.com";
function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) { const error = new Error("Missing " + name); error.code = "GITHUB_CONFIG_MISSING"; throw error; }
  return value;
}
function config() { return { tokenConfigured: Boolean(String(process.env.GITHUB_TOKEN || "").trim()), owner: String(process.env.GITHUB_OWNER || "").trim(), repo: String(process.env.GITHUB_REPO || "").trim() }; }
async function request(pathname, options = {}) {
  const token = required("GITHUB_TOKEN");
  const response = await fetch(API + pathname, { ...options, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: "Bearer " + token, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) { const error = new Error("GitHub API " + response.status + ": " + (body?.message || text || "request failed")); error.code = "GITHUB_API_ERROR"; error.status = response.status; throw error; }
  return body;
}
function repository() { return required("GITHUB_OWNER") + "/" + required("GITHUB_REPO"); }
async function workflowRun(runId) { return request("/repos/" + repository() + "/actions/runs/" + encodeURIComponent(runId)); }
async function workflowJobs(runId) { return request("/repos/" + repository() + "/actions/runs/" + encodeURIComponent(runId) + "/jobs?per_page=100"); }
async function repositoryInfo() { return request("/repos/" + repository()); }
async function createBranch(branch, sha) { return request("/repos/" + repository() + "/git/refs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "refs/heads/" + branch, sha }) }); }
async function createPullRequest({ title, body, head, base = "main", draft = true }) { return request("/repos/" + repository() + "/pulls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body, head, base, draft }) }); }
module.exports = { config, repository, workflowRun, workflowJobs, repositoryInfo, createBranch, createPullRequest };
