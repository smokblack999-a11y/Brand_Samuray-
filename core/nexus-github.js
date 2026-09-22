"use strict";

const { diagnose } = require("./nexus-diagnosis");

function normalizeRepo(repository) {
  if (!repository) throw new Error("repository is required");
  return String(repository).replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
}

function createGitHubClient({ token, apiBase = "https://api.github.com" } = {}) {
  if (!token) throw new Error("GitHub token is required");

  async function request(path) {
    const response = await fetch(`${apiBase}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NEXUS-Proof-to-Ship"
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`);
    }
    return response;
  }

  async function getWorkflowRun(repository, runId) {
    const repo = normalizeRepo(repository);
    const response = await request(`/repos/${repo}/actions/runs/${encodeURIComponent(runId)}`);
    return response.json();
  }

  async function listWorkflowJobs(repository, runId) {
    const repo = normalizeRepo(repository);
    const response = await request(`/repos/${repo}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
    const data = await response.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  }

  async function getJobLogs(repository, jobId) {
    const repo = normalizeRepo(repository);
    const response = await request(`/repos/${repo}/actions/jobs/${encodeURIComponent(jobId)}/logs`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/")) return response.text();
    return "";
  }

  async function collectFailure(job) {
    const run = await getWorkflowRun(job.repository, job.runId);
    if (run.conclusion !== "failure") throw new Error(`Workflow run ${job.runId} is not failed`);
    const jobs = await listWorkflowJobs(job.repository, job.runId);
    const failedJobs = jobs.filter((item) => item.conclusion === "failure");
    let logs = "";
    for (const failedJob of failedJobs.slice(0, 3)) {
      try {
        logs += `\n### ${failedJob.name}\n${await getJobLogs(job.repository, failedJob.id)}`;
      } catch (_error) {
        // Step metadata remains valid evidence when GitHub log download is unavailable.
      }
    }
    return diagnose({ run, jobs: failedJobs, logs });
  }

  return { getWorkflowRun, listWorkflowJobs, getJobLogs, collectFailure };
}

module.exports = { createGitHubClient, normalizeRepo };
